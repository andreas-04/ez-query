package server

// e2e_test.go exercises every gRPC service end-to-end against a real
// PostgreSQL database.
//
// Prerequisites:
//   - A running Postgres instance with the schema already applied.
//   - The TEST_DATABASE_URL environment variable pointing to it, e.g.
//       TEST_DATABASE_URL=postgres://user:pass@localhost/otto_test?sslmode=disable
//
// Run with:
//
//	TEST_DATABASE_URL=... go test ./internal/server/ -v -run TestE2E

import (
	"context"
	"database/sql"
	"net"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	commonv1 "otto/internal/gen/common/v1"
	employeev1 "otto/internal/gen/employee/v1"
	jobv1 "otto/internal/gen/job/v1"
	payrollv1 "otto/internal/gen/payroll/v1"
	schedulingv1 "otto/internal/gen/scheduling/v1"
)

// ----------------------------------------------------------------------------
// Test harness
// ----------------------------------------------------------------------------

type testEnv struct {
	db         *sql.DB
	employee   employeev1.EmployeeServiceClient
	payroll    payrollv1.PayrollServiceClient
	scheduling schedulingv1.SchedulingServiceClient
	job        jobv1.JobServiceClient
}

// newTestEnv opens the database, registers all four servers on a bufconn
// listener, and returns clients wired to them.  The caller must call cleanup().
func newTestEnv(t *testing.T) (*testEnv, func()) {
	t.Helper()

	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set – skipping e2e tests")
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping db: %v", err)
	}

	// In-process listener so no port is needed.
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	grpcSrv := grpc.NewServer()
	employeev1.RegisterEmployeeServiceServer(grpcSrv, NewEmployeeServer(db))
	payrollv1.RegisterPayrollServiceServer(grpcSrv, NewPayrollServer(db))
	schedulingv1.RegisterSchedulingServiceServer(grpcSrv, NewSchedulingServer(db))
	jobv1.RegisterJobServiceServer(grpcSrv, NewJobServer(db))

	go grpcSrv.Serve(lis) //nolint:errcheck

	conn, err := grpc.NewClient(
		lis.Addr().String(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	env := &testEnv{
		db:         db,
		employee:   employeev1.NewEmployeeServiceClient(conn),
		payroll:    payrollv1.NewPayrollServiceClient(conn),
		scheduling: schedulingv1.NewSchedulingServiceClient(conn),
		job:        jobv1.NewJobServiceClient(conn),
	}
	cleanup := func() {
		conn.Close()
		grpcSrv.Stop()
		db.Close()
	}
	return env, cleanup
}

// seedEmployee inserts a test employee and returns its ID.
func seedEmployee(t *testing.T, db *sql.DB, name, email, department string, workerType int) string {
	t.Helper()
	var id string
	err := db.QueryRowContext(context.Background(), `
		INSERT INTO employees (name, email, department, worker_type)
		VALUES ($1, $2, $3, $4)
		RETURNING id`, name, email, department, workerType).Scan(&id)
	if err != nil {
		t.Fatalf("seed employee: %v", err)
	}
	return id
}

// cleanupEmployee deletes an employee (cascade cleans all related rows).
func cleanupEmployee(t *testing.T, db *sql.DB, id string) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(),
		`DELETE FROM employees WHERE id = $1`, id); err != nil {
		t.Logf("cleanup employee %s: %v", id, err)
	}
}

// cleanupJob deletes a job and its children.
func cleanupJob(t *testing.T, db *sql.DB, id string) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(),
		`DELETE FROM jobs WHERE id = $1`, id); err != nil {
		t.Logf("cleanup job %s: %v", id, err)
	}
}

// ----------------------------------------------------------------------------
// Employee service
// ----------------------------------------------------------------------------

func TestE2E_Employee_GetByID(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	empID := seedEmployee(t, env.db, "Alice Doe", "alice.e2e@example.com", "Engineering", 1)
	defer cleanupEmployee(t, env.db, empID)

	resp, err := env.employee.GetEmployee(context.Background(), &employeev1.GetEmployeeRequest{
		Lookup: &employeev1.GetEmployeeRequest_Id{Id: empID},
	})
	if err != nil {
		t.Fatalf("GetEmployee by id: %v", err)
	}
	if resp.Id != empID {
		t.Errorf("id: got %q want %q", resp.Id, empID)
	}
	if resp.Name != "Alice Doe" {
		t.Errorf("name: got %q want %q", resp.Name, "Alice Doe")
	}
	if resp.WorkerType != commonv1.WorkerType_OFFICE {
		t.Errorf("worker_type: got %v want OFFICE", resp.WorkerType)
	}
}

func TestE2E_Employee_GetByName(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	empID := seedEmployee(t, env.db, "Bob E2E", "bob.e2e@example.com", "Operations", 2)
	defer cleanupEmployee(t, env.db, empID)

	resp, err := env.employee.GetEmployee(context.Background(), &employeev1.GetEmployeeRequest{
		Lookup: &employeev1.GetEmployeeRequest_Name{Name: "Bob E2E"},
	})
	if err != nil {
		t.Fatalf("GetEmployee by name: %v", err)
	}
	if resp.Email != "bob.e2e@example.com" {
		t.Errorf("email: got %q", resp.Email)
	}
}

func TestE2E_Employee_ListEmployees(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	id1 := seedEmployee(t, env.db, "Charlie List", "charlie.list@example.com", "Finance", 1)
	id2 := seedEmployee(t, env.db, "Diana List", "diana.list@example.com", "Finance", 1)
	defer cleanupEmployee(t, env.db, id1)
	defer cleanupEmployee(t, env.db, id2)

	dept := "Finance"
	resp, err := env.employee.ListEmployees(context.Background(), &employeev1.ListEmployeesRequest{
		Department: &dept,
	})
	if err != nil {
		t.Fatalf("ListEmployees: %v", err)
	}
	found := 0
	for _, e := range resp.Employees {
		if e.Id == id1 || e.Id == id2 {
			found++
		}
	}
	if found != 2 {
		t.Errorf("expected 2 seeded employees in Finance, got %d total results", found)
	}
}

// ----------------------------------------------------------------------------
// Payroll service
// ----------------------------------------------------------------------------

func TestE2E_Payroll_GetPayroll_Latest(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	empID := seedEmployee(t, env.db, "Eve Payroll", "eve.payroll@example.com", "HR", 1)
	defer cleanupEmployee(t, env.db, empID)

	// Insert two pay runs; "latest" should return the second one.
	_, err := env.db.ExecContext(context.Background(), `
		INSERT INTO pay_runs (employee_id, period_start, period_end, gross_amount, gross_currency, net_amount, net_currency, status)
		VALUES
		  ($1, '2024-01-01', '2024-01-31', 500000, 'USD', 400000, 'USD', 'paid'),
		  ($1, '2024-02-01', '2024-02-29', 510000, 'USD', 408000, 'USD', 'paid')`,
		empID,
	)
	if err != nil {
		t.Fatalf("seed pay_runs: %v", err)
	}

	pp := "latest"
	resp, err := env.payroll.GetPayroll(context.Background(), &payrollv1.GetPayrollRequest{
		EmployeeId: empID,
		PayPeriod:  &pp,
	})
	if err != nil {
		t.Fatalf("GetPayroll latest: %v", err)
	}
	if len(resp.PayRuns) != 1 {
		t.Fatalf("expected 1 pay run, got %d", len(resp.PayRuns))
	}
	if resp.PayRuns[0].PeriodStart != "2024-02-01" {
		t.Errorf("period_start: got %q want 2024-02-01", resp.PayRuns[0].PeriodStart)
	}
}

func TestE2E_Payroll_GetPaySchedule(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	empID := seedEmployee(t, env.db, "Frank Schedule", "frank.sched@example.com", "IT", 1)
	defer cleanupEmployee(t, env.db, empID)

	_, err := env.db.ExecContext(context.Background(), `
		INSERT INTO pay_schedules (employee_id, frequency, effective_date, next_pay_date)
		VALUES ($1, 2, '2024-01-01', '2024-01-15')`, empID)
	if err != nil {
		t.Fatalf("seed pay_schedule: %v", err)
	}

	resp, err := env.payroll.GetPaySchedule(context.Background(), &payrollv1.GetPayScheduleRequest{
		EmployeeId: empID,
	})
	if err != nil {
		t.Fatalf("GetPaySchedule: %v", err)
	}
	if resp.Frequency != commonv1.PayFrequency_PAY_FREQUENCY_BIWEEKLY {
		t.Errorf("frequency: got %v want BIWEEKLY", resp.Frequency)
	}
}

// ----------------------------------------------------------------------------
// Scheduling service
// ----------------------------------------------------------------------------

func TestE2E_Scheduling_CreateAndGetShift(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	empID := seedEmployee(t, env.db, "Grace Shift", "grace.shift@example.com", "Ops", 1)
	defer cleanupEmployee(t, env.db, empID)

	notes := "morning shift"
	shift, err := env.scheduling.CreateShift(context.Background(), &schedulingv1.CreateShiftRequest{
		EmployeeId: empID,
		StartTime:  "2024-06-10T09:00:00Z",
		EndTime:    "2024-06-10T17:00:00Z",
		Notes:      &notes,
	})
	if err != nil {
		t.Fatalf("CreateShift: %v", err)
	}
	if shift.Id == "" {
		t.Fatal("expected non-empty shift id")
	}
	if shift.Status != commonv1.ShiftStatus_SHIFT_STATUS_SCHEDULED {
		t.Errorf("initial status: got %v want SCHEDULED", shift.Status)
	}

	got, err := env.scheduling.GetShift(context.Background(), &schedulingv1.GetShiftRequest{Id: shift.Id})
	if err != nil {
		t.Fatalf("GetShift: %v", err)
	}
	if got.Notes != notes {
		t.Errorf("notes: got %q want %q", got.Notes, notes)
	}
}

func TestE2E_Scheduling_UpdateShift(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	empID := seedEmployee(t, env.db, "Hank Update", "hank.update@example.com", "Ops", 1)
	defer cleanupEmployee(t, env.db, empID)

	shift, err := env.scheduling.CreateShift(context.Background(), &schedulingv1.CreateShiftRequest{
		EmployeeId: empID,
		StartTime:  "2024-07-01T08:00:00Z",
		EndTime:    "2024-07-01T16:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateShift: %v", err)
	}

	newStatus := commonv1.ShiftStatus_SHIFT_STATUS_COMPLETED
	updated, err := env.scheduling.UpdateShift(context.Background(), &schedulingv1.UpdateShiftRequest{
		Id:     shift.Id,
		Status: &newStatus,
	})
	if err != nil {
		t.Fatalf("UpdateShift: %v", err)
	}
	if updated.Status != commonv1.ShiftStatus_SHIFT_STATUS_COMPLETED {
		t.Errorf("status after update: got %v want COMPLETED", updated.Status)
	}
}

func TestE2E_Scheduling_RequestTimeOff_And_Availability(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	empID := seedEmployee(t, env.db, "Iris TimeOff", "iris.timeoff@example.com", "Finance", 1)
	defer cleanupEmployee(t, env.db, empID)

	_, err := env.scheduling.RequestTimeOff(context.Background(), &schedulingv1.TimeOffRequest{
		EmployeeId: empID,
		StartDate:  "2024-08-05",
		EndDate:    "2024-08-07",
		Reason:     "vacation",
	})
	if err != nil {
		t.Fatalf("RequestTimeOff: %v", err)
	}

	avail, err := env.scheduling.GetAvailability(context.Background(), &schedulingv1.GetAvailabilityRequest{
		EmployeeId: empID,
		DateRange: &commonv1.DateRange{
			StartDate: "2024-08-01",
			EndDate:   "2024-08-10",
		},
	})
	if err != nil {
		t.Fatalf("GetAvailability: %v", err)
	}
	// 3-day time-off should produce 3 days_off entries.
	if len(avail.DaysOff) != 3 {
		t.Errorf("days_off count: got %d want 3", len(avail.DaysOff))
	}
}

// ----------------------------------------------------------------------------
// Job service
// ----------------------------------------------------------------------------

func TestE2E_Job_CreateAndGet(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	job, err := env.job.CreateJob(context.Background(), &jobv1.CreateJobRequest{
		Title:          "Install HVAC",
		Description:    "Install new unit at client site",
		ScheduledStart: "2024-09-01T08:00:00Z",
		ScheduledEnd:   "2024-09-01T17:00:00Z",
		Location: &commonv1.Address{
			Line1:    "123 Main St",
			City:     "Springfield",
			State:    "IL",
			Postcode: "62701",
			Country:  "US",
		},
	})
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	defer cleanupJob(t, env.db, job.Id)

	if job.Status != commonv1.JobStatus_JOB_STATUS_SCHEDULED {
		t.Errorf("initial status: got %v want SCHEDULED", job.Status)
	}

	got, err := env.job.GetJob(context.Background(), &jobv1.GetJobRequest{Id: job.Id})
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if got.Title != "Install HVAC" {
		t.Errorf("title: got %q", got.Title)
	}
	if got.Location == nil || got.Location.City != "Springfield" {
		t.Errorf("location city: got %v", got.Location)
	}
}

func TestE2E_Job_AssignEmployees(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	empID := seedEmployee(t, env.db, "Jack Field", "jack.field@example.com", "Field", 2)
	defer cleanupEmployee(t, env.db, empID)

	job, err := env.job.CreateJob(context.Background(), &jobv1.CreateJobRequest{
		Title:          "Plumbing Repair",
		ScheduledStart: "2024-10-01T09:00:00Z",
		ScheduledEnd:   "2024-10-01T13:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	defer cleanupJob(t, env.db, job.Id)

	updated, err := env.job.AssignEmployees(context.Background(), &jobv1.AssignEmployeesRequest{
		JobId:       job.Id,
		EmployeeIds: []string{empID},
	})
	if err != nil {
		t.Fatalf("AssignEmployees: %v", err)
	}
	if len(updated.AssignedEmployeeIds) != 1 || updated.AssignedEmployeeIds[0] != empID {
		t.Errorf("assigned_employee_ids: got %v", updated.AssignedEmployeeIds)
	}
}

func TestE2E_Job_UpdateStatus(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	job, err := env.job.CreateJob(context.Background(), &jobv1.CreateJobRequest{
		Title:          "Status Flow Test",
		ScheduledStart: "2024-11-01T08:00:00Z",
		ScheduledEnd:   "2024-11-01T12:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	defer cleanupJob(t, env.db, job.Id)

	updated, err := env.job.UpdateJobStatus(context.Background(), &jobv1.UpdateJobStatusRequest{
		JobId:  job.Id,
		Status: commonv1.JobStatus_JOB_STATUS_IN_PROGRESS,
	})
	if err != nil {
		t.Fatalf("UpdateJobStatus: %v", err)
	}
	if updated.Status != commonv1.JobStatus_JOB_STATUS_IN_PROGRESS {
		t.Errorf("status: got %v want IN_PROGRESS", updated.Status)
	}
}

func TestE2E_Job_GetJobLocation(t *testing.T) {
	env, done := newTestEnv(t)
	defer done()

	job, err := env.job.CreateJob(context.Background(), &jobv1.CreateJobRequest{
		Title:          "Location Test",
		ScheduledStart: "2024-12-01T08:00:00Z",
		ScheduledEnd:   "2024-12-01T09:00:00Z",
	})
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	defer cleanupJob(t, env.db, job.Id)

	// Manually set coordinates in job_locations.
	if _, err := env.db.ExecContext(context.Background(), `
		INSERT INTO job_locations (job_id, lat, lng) VALUES ($1, 39.7817, -89.6501)`,
		job.Id,
	); err != nil {
		t.Fatalf("seed job_location: %v", err)
	}

	loc, err := env.job.GetJobLocation(context.Background(), &jobv1.GetJobLocationRequest{JobId: job.Id})
	if err != nil {
		t.Fatalf("GetJobLocation: %v", err)
	}
	if loc.Coordinates == nil {
		t.Fatal("expected coordinates, got nil")
	}
	if loc.Coordinates.Lat < 39.0 || loc.Coordinates.Lat > 40.0 {
		t.Errorf("lat out of expected range: %f", loc.Coordinates.Lat)
	}
}
