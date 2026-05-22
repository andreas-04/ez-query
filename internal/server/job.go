package server

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	commonv1 "otto/internal/gen/common/v1"
	jobv1 "otto/internal/gen/job/v1"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// JobServer implements jobv1.JobServiceServer against Postgres.
type JobServer struct {
	jobv1.UnimplementedJobServiceServer
	db *sql.DB
}

// NewJobServer wires up the server with an open database connection.
func NewJobServer(db *sql.DB) *JobServer {
	return &JobServer{db: db}
}

// CreateJob inserts a new job and returns the persisted record.
func (s *JobServer) CreateJob(ctx context.Context, req *jobv1.CreateJobRequest) (*jobv1.Job, error) {
	if req.Title == "" || req.ScheduledStart == "" || req.ScheduledEnd == "" {
		return nil, status.Error(codes.InvalidArgument, "title, scheduled_start and scheduled_end are required")
	}
	loc := req.Location
	if loc == nil {
		loc = &commonv1.Address{}
	}

	q := dbQ(ctx, s.db)
	row := q.QueryRowContext(ctx, `
		INSERT INTO jobs
		    (tenant_id, title, description, status,
		     loc_line1, loc_line2, loc_city, loc_state, loc_postcode, loc_country,
		     scheduled_start, scheduled_end)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz)
		RETURNING id, created_at::text`,
		TenantIDFromCtx(ctx),
		req.Title, req.Description,
		int32(commonv1.JobStatus_JOB_STATUS_SCHEDULED),
		loc.Line1, loc.Line2, loc.City, loc.State, loc.Postcode, loc.Country,
		req.ScheduledStart, req.ScheduledEnd,
	)

	var id, createdAt string
	if err := row.Scan(&id, &createdAt); err != nil {
		return nil, dbErr(err, "insert job")
	}
	return s.fetchJob(ctx, id)
}

// GetJob retrieves a single job by UUID.
func (s *JobServer) GetJob(ctx context.Context, req *jobv1.GetJobRequest) (*jobv1.Job, error) {
	if req.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "id is required")
	}
	return s.fetchJob(ctx, req.Id)
}

// ListJobs returns jobs filtered by employee, date range, status, and/or city.
func (s *JobServer) ListJobs(ctx context.Context, req *jobv1.ListJobsRequest) (*jobv1.ListJobsResponse, error) {
	query := `
		SELECT DISTINCT j.id
		FROM jobs j
		LEFT JOIN job_employees je ON je.job_id = j.id
		WHERE TRUE`
	args := []any{}

	if req.EmployeeId != nil {
		args = append(args, *req.EmployeeId)
		query += fmt.Sprintf(" AND je.employee_id = $%d", len(args))
	}
	if req.DateRange != nil {
		args = append(args, req.DateRange.StartDate, req.DateRange.EndDate)
		query += fmt.Sprintf(
			" AND j.scheduled_start <= $%d::timestamptz AND j.scheduled_end >= $%d::timestamptz",
			len(args)-1, len(args),
		)
	}
	if req.Status != nil {
		args = append(args, int32(*req.Status))
		query += fmt.Sprintf(" AND j.status = $%d", len(args))
	}
	if req.City != nil {
		args = append(args, *req.City)
		query += fmt.Sprintf(" AND LOWER(j.loc_city) = LOWER($%d)", len(args))
	}
	query += " ORDER BY j.id"

	q := dbQ(ctx, s.db)
	idRows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, dbErr(err, "query jobs")
	}
	defer idRows.Close()

	var ids []string
	for idRows.Next() {
		var id string
		if err := idRows.Scan(&id); err != nil {
			return nil, dbErr(err, "scan job id")
		}
		ids = append(ids, id)
	}
	if err := idRows.Err(); err != nil {
		return nil, dbErr(err, "rows")
	}

	jobs := make([]*jobv1.Job, 0, len(ids))
	for _, id := range ids {
		j, err := s.fetchJob(ctx, id)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}

	return &jobv1.ListJobsResponse{
		Jobs:       jobs,
		TotalCount: int32(len(jobs)),
	}, nil
}

// AssignEmployees appends employees to a job without removing existing ones.
func (s *JobServer) AssignEmployees(ctx context.Context, req *jobv1.AssignEmployeesRequest) (*jobv1.Job, error) {
	if req.JobId == "" {
		return nil, status.Error(codes.InvalidArgument, "job_id is required")
	}
	if len(req.EmployeeIds) == 0 {
		return s.fetchJob(ctx, req.JobId)
	}

	tenantID := TenantIDFromCtx(ctx)
	placeholders := make([]string, len(req.EmployeeIds))
	args := []any{tenantID, req.JobId}
	for i, eid := range req.EmployeeIds {
		args = append(args, eid)
		placeholders[i] = fmt.Sprintf("($1, $2, $%d)", i+3)
	}
	query := fmt.Sprintf(`
		INSERT INTO job_employees (tenant_id, job_id, employee_id) VALUES %s
		ON CONFLICT DO NOTHING`,
		strings.Join(placeholders, ", "),
	)
	q := dbQ(ctx, s.db)
	if _, err := q.ExecContext(ctx, query, args...); err != nil {
		return nil, dbErr(err, "assign employees")
	}
	return s.fetchJob(ctx, req.JobId)
}

// UpdateJobStatus transitions a job's status and optionally sets actual timestamps.
func (s *JobServer) UpdateJobStatus(ctx context.Context, req *jobv1.UpdateJobStatusRequest) (*jobv1.Job, error) {
	if req.JobId == "" {
		return nil, status.Error(codes.InvalidArgument, "job_id is required")
	}

	args := []any{int32(req.Status)}
	setClauses := []string{"status = $1"}

	if req.ActualStart != nil {
		args = append(args, *req.ActualStart)
		setClauses = append(setClauses, fmt.Sprintf("actual_start = $%d::timestamptz", len(args)))
	}
	if req.ActualEnd != nil {
		args = append(args, *req.ActualEnd)
		setClauses = append(setClauses, fmt.Sprintf("actual_end = $%d::timestamptz", len(args)))
	}

	args = append(args, req.JobId)
	query := fmt.Sprintf(
		"UPDATE jobs SET %s WHERE id = $%d",
		strings.Join(setClauses, ", "), len(args),
	)

	q := dbQ(ctx, s.db)
	res, err := q.ExecContext(ctx, query, args...)
	if err != nil {
		return nil, dbErr(err, "update job status")
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, status.Error(codes.NotFound, "job not found")
	}
	return s.fetchJob(ctx, req.JobId)
}

// GetJobLocation returns address and GPS coordinates for a job site.
func (s *JobServer) GetJobLocation(ctx context.Context, req *jobv1.GetJobLocationRequest) (*jobv1.JobLocation, error) {
	if req.JobId == "" {
		return nil, status.Error(codes.InvalidArgument, "job_id is required")
	}

	q := dbQ(ctx, s.db)
	row := q.QueryRowContext(ctx, `
		SELECT j.id,
		       j.loc_line1, j.loc_line2, j.loc_city, j.loc_state, j.loc_postcode, j.loc_country,
		       COALESCE(jl.lat, 0), COALESCE(jl.lng, 0)
		FROM jobs j
		LEFT JOIN job_locations jl ON jl.job_id = j.id
		WHERE j.id = $1`,
		req.JobId,
	)

	var jl jobv1.JobLocation
	var addr commonv1.Address
	var lat, lng float64
	if err := row.Scan(
		&jl.JobId,
		&addr.Line1, &addr.Line2, &addr.City, &addr.State, &addr.Postcode, &addr.Country,
		&lat, &lng,
	); err != nil {
		return nil, dbErr(err, "scan job_location")
	}
	jl.Address = &addr
	jl.Coordinates = &jobv1.Coordinates{Lat: lat, Lng: lng}
	return &jl, nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// fetchJob loads a full Job record including its assigned employee IDs.
func (s *JobServer) fetchJob(ctx context.Context, id string) (*jobv1.Job, error) {
	q := dbQ(ctx, s.db)
	row := q.QueryRowContext(ctx, `
		SELECT id, title, description, status,
		       loc_line1, loc_line2, loc_city, loc_state, loc_postcode, loc_country,
		       scheduled_start::text, scheduled_end::text,
		       COALESCE(actual_start::text, ''), COALESCE(actual_end::text, ''),
		       created_at::text
		FROM jobs WHERE id = $1`, id)

	var j jobv1.Job
	var st int32
	var addr commonv1.Address
	if err := row.Scan(
		&j.Id, &j.Title, &j.Description, &st,
		&addr.Line1, &addr.Line2, &addr.City, &addr.State, &addr.Postcode, &addr.Country,
		&j.ScheduledStart, &j.ScheduledEnd,
		&j.ActualStart, &j.ActualEnd,
		&j.CreatedAt,
	); err != nil {
		return nil, dbErr(err, "scan job")
	}
	j.Status = commonv1.JobStatus(st)
	j.Location = &addr

	// Load assigned employee IDs.
	eidRows, err := q.QueryContext(ctx,
		"SELECT employee_id FROM job_employees WHERE job_id = $1 ORDER BY employee_id", id)
	if err != nil {
		return nil, dbErr(err, "query job_employees")
	}
	defer eidRows.Close()
	for eidRows.Next() {
		var eid string
		if err := eidRows.Scan(&eid); err != nil {
			return nil, dbErr(err, "scan employee_id")
		}
		j.AssignedEmployeeIds = append(j.AssignedEmployeeIds, eid)
	}
	return &j, nil
}
