package server

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strconv"

	commonv1 "otto/internal/gen/common/v1"
	payrollv1 "otto/internal/gen/payroll/v1"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// PayrollServer implements payrollv1.PayrollServiceServer against Postgres.
type PayrollServer struct {
	payrollv1.UnimplementedPayrollServiceServer
	db *sql.DB
}

// NewPayrollServer wires up the server with an open database connection.
func NewPayrollServer(db *sql.DB) *PayrollServer {
	return &PayrollServer{db: db}
}

// quarterRE matches strings like "2024-Q1".
var quarterRE = regexp.MustCompile(`^(\d{4})-Q([1-4])$`)

// GetPayroll returns pay runs for an employee, scoped by an optional period qualifier.
func (s *PayrollServer) GetPayroll(ctx context.Context, req *payrollv1.GetPayrollRequest) (*payrollv1.GetPayrollResponse, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}

	query := `
		SELECT id, employee_id,
		       period_start::text, period_end::text,
		       gross_amount, gross_currency,
		       net_amount, net_currency,
		       status, COALESCE(paid_at::text, '')
		FROM pay_runs
		WHERE employee_id = $1`
	args := []any{req.EmployeeId}

	if req.PayPeriod != nil {
		pp := *req.PayPeriod
		switch {
		case pp == "latest":
			query += " ORDER BY period_end DESC LIMIT 1"

		case quarterRE.MatchString(pp):
			m := quarterRE.FindStringSubmatch(pp)
			year, _ := strconv.Atoi(m[1])
			quarter, _ := strconv.Atoi(m[2])
			startMonth := (quarter-1)*3 + 1
			endMonth := startMonth + 2
			start := fmt.Sprintf("%04d-%02d-01", year, startMonth)
			end := fmt.Sprintf("%04d-%02d-01", year, endMonth)
			// last day of end month via next month minus 1 day
			args = append(args, start, end)
			query += fmt.Sprintf(
				" AND period_start >= $%d AND period_start < $%d ORDER BY period_start",
				len(args)-1, len(args),
			)

		default:
			// treat as an exact ISO 8601 period_start date
			args = append(args, pp)
			query += fmt.Sprintf(" AND period_start = $%d ORDER BY period_start", len(args))
		}
	} else {
		query += " ORDER BY period_start"
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "query pay_runs: %v", err)
	}
	defer rows.Close()

	var runs []*payrollv1.PayRun
	for rows.Next() {
		r, err := scanPayRun(rows)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "scan pay_run: %v", err)
		}
		runs = append(runs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, status.Errorf(codes.Internal, "rows error: %v", err)
	}

	return &payrollv1.GetPayrollResponse{
		EmployeeId: req.EmployeeId,
		PayRuns:    runs,
	}, nil
}

// GetPaySchedule returns the pay schedule for an employee.
func (s *PayrollServer) GetPaySchedule(ctx context.Context, req *payrollv1.GetPayScheduleRequest) (*payrollv1.PaySchedule, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}

	row := s.db.QueryRowContext(ctx, `
		SELECT id, employee_id, frequency,
		       effective_date::text, next_pay_date::text
		FROM pay_schedules
		WHERE employee_id = $1`,
		req.EmployeeId,
	)

	var ps payrollv1.PaySchedule
	var freq int32
	err := row.Scan(&ps.Id, &ps.EmployeeId, &freq, &ps.EffectiveDate, &ps.NextPayDate)
	if err == sql.ErrNoRows {
		return nil, status.Error(codes.NotFound, "pay schedule not found for employee")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "scan pay_schedule: %v", err)
	}
	ps.Frequency = commonv1.PayFrequency(freq)
	return &ps, nil
}

// ListPayRuns returns a filtered list of pay runs for an employee.
func (s *PayrollServer) ListPayRuns(ctx context.Context, req *payrollv1.ListPayRunsRequest) (*payrollv1.ListPayRunsResponse, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}

	query := `
		SELECT id, employee_id,
		       period_start::text, period_end::text,
		       gross_amount, gross_currency,
		       net_amount, net_currency,
		       status, COALESCE(paid_at::text, '')
		FROM pay_runs
		WHERE employee_id = $1`
	args := []any{req.EmployeeId}

	if req.DateRange != nil {
		args = append(args, req.DateRange.StartDate, req.DateRange.EndDate)
		query += fmt.Sprintf(
			" AND period_start <= $%d AND period_end >= $%d",
			len(args)-1, len(args),
		)
	}
	if req.Status != nil {
		args = append(args, *req.Status)
		query += fmt.Sprintf(" AND status = $%d", len(args))
	}
	query += " ORDER BY period_start"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "query pay_runs: %v", err)
	}
	defer rows.Close()

	var runs []*payrollv1.PayRun
	for rows.Next() {
		r, err := scanPayRun(rows)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "scan pay_run: %v", err)
		}
		runs = append(runs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, status.Errorf(codes.Internal, "rows error: %v", err)
	}

	return &payrollv1.ListPayRunsResponse{
		PayRuns:    runs,
		TotalCount: int32(len(runs)),
	}, nil
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

func scanPayRun(rows *sql.Rows) (*payrollv1.PayRun, error) {
	var r payrollv1.PayRun
	var grossAmt, netAmt int64
	var grossCur, netCur string
	err := rows.Scan(
		&r.Id, &r.EmployeeId,
		&r.PeriodStart, &r.PeriodEnd,
		&grossAmt, &grossCur,
		&netAmt, &netCur,
		&r.Status, &r.PaidAt,
	)
	if err != nil {
		return nil, err
	}
	r.Gross = &commonv1.Money{Amount: grossAmt, CurrencyCode: grossCur}
	r.Net = &commonv1.Money{Amount: netAmt, CurrencyCode: netCur}
	return &r, nil
}
