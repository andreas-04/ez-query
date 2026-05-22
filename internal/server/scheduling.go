package server

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	commonv1 "otto/internal/gen/common/v1"
	schedulingv1 "otto/internal/gen/scheduling/v1"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// SchedulingServer implements schedulingv1.SchedulingServiceServer against Postgres.
type SchedulingServer struct {
	schedulingv1.UnimplementedSchedulingServiceServer
	db *sql.DB
}

// NewSchedulingServer wires up the server with an open database connection.
func NewSchedulingServer(db *sql.DB) *SchedulingServer {
	return &SchedulingServer{db: db}
}

// CreateShift inserts a new shift and returns the persisted record.
func (s *SchedulingServer) CreateShift(ctx context.Context, req *schedulingv1.CreateShiftRequest) (*schedulingv1.Shift, error) {
	if req.EmployeeId == "" || req.StartTime == "" || req.EndTime == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id, start_time and end_time are required")
	}
	notes := ""
	if req.Notes != nil {
		notes = *req.Notes
	}

	q := dbQ(ctx, s.db)
	row := q.QueryRowContext(ctx, `
		INSERT INTO shifts (tenant_id, employee_id, start_time, end_time, status, notes)
		VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6)
		RETURNING id, employee_id,
		          start_time::text, end_time::text,
		          status, notes, created_at::text`,
		TenantIDFromCtx(ctx), req.EmployeeId, req.StartTime, req.EndTime,
		int32(commonv1.ShiftStatus_SHIFT_STATUS_SCHEDULED), notes,
	)
	return scanShiftRow(row)
}

// GetShift retrieves a single shift by UUID.
func (s *SchedulingServer) GetShift(ctx context.Context, req *schedulingv1.GetShiftRequest) (*schedulingv1.Shift, error) {
	if req.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "id is required")
	}
	q := dbQ(ctx, s.db)
	row := q.QueryRowContext(ctx, `
		SELECT id, employee_id,
		       start_time::text, end_time::text,
		       status, notes, created_at::text
		FROM shifts WHERE id = $1`, req.Id)
	return scanShiftRow(row)
}

// ListShifts returns shifts for an employee with optional date-range and status filters.
func (s *SchedulingServer) ListShifts(ctx context.Context, req *schedulingv1.ListShiftsRequest) (*schedulingv1.ListShiftsResponse, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}
	query := `
		SELECT id, employee_id,
		       start_time::text, end_time::text,
		       status, notes, created_at::text
		FROM shifts
		WHERE employee_id = $1`
	args := []any{req.EmployeeId}

	if req.DateRange != nil {
		args = append(args, req.DateRange.StartDate, req.DateRange.EndDate)
		query += fmt.Sprintf(
			" AND start_time <= $%d::timestamptz AND end_time >= $%d::timestamptz",
			len(args)-1, len(args),
		)
	}
	if req.Status != nil {
		args = append(args, int32(*req.Status))
		query += fmt.Sprintf(" AND status = $%d", len(args))
	}
	query += " ORDER BY start_time"

	q := dbQ(ctx, s.db)
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, dbErr(err, "query shifts")
	}
	defer rows.Close()

	var shifts []*schedulingv1.Shift
	for rows.Next() {
		sh, err := scanShiftRows(rows)
		if err != nil {
			return nil, dbErr(err, "scan shift")
		}
		shifts = append(shifts, sh)
	}
	if err := rows.Err(); err != nil {
		return nil, dbErr(err, "rows")
	}
	return &schedulingv1.ListShiftsResponse{
		Shifts:     shifts,
		TotalCount: int32(len(shifts)),
	}, nil
}

// UpdateShift applies a partial update — only non-nil fields are written.
func (s *SchedulingServer) UpdateShift(ctx context.Context, req *schedulingv1.UpdateShiftRequest) (*schedulingv1.Shift, error) {
	if req.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "id is required")
	}

	setClauses := []string{}
	args := []any{}

	if req.StartTime != nil {
		args = append(args, *req.StartTime)
		setClauses = append(setClauses, fmt.Sprintf("start_time = $%d::timestamptz", len(args)))
	}
	if req.EndTime != nil {
		args = append(args, *req.EndTime)
		setClauses = append(setClauses, fmt.Sprintf("end_time = $%d::timestamptz", len(args)))
	}
	if req.Status != nil {
		args = append(args, int32(*req.Status))
		setClauses = append(setClauses, fmt.Sprintf("status = $%d", len(args)))
	}
	if req.Notes != nil {
		args = append(args, *req.Notes)
		setClauses = append(setClauses, fmt.Sprintf("notes = $%d", len(args)))
	}
	if len(setClauses) == 0 {
		return nil, status.Error(codes.InvalidArgument, "at least one field must be updated")
	}

	q := dbQ(ctx, s.db)
	args = append(args, req.Id)
	query := fmt.Sprintf(`
		UPDATE shifts SET %s WHERE id = $%d
		RETURNING id, employee_id,
		          start_time::text, end_time::text,
		          status, notes, created_at::text`,
		strings.Join(setClauses, ", "), len(args),
	)

	row := q.QueryRowContext(ctx, query, args...)
	return scanShiftRow(row)
}

// RequestTimeOff inserts a time-off request and returns an automatic approval.
func (s *SchedulingServer) RequestTimeOff(ctx context.Context, req *schedulingv1.TimeOffRequest) (*schedulingv1.TimeOffResponse, error) {
	if req.EmployeeId == "" || req.StartDate == "" || req.EndDate == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id, start_date and end_date are required")
	}

	q := dbQ(ctx, s.db)
	_, err := q.ExecContext(ctx, `
		INSERT INTO time_off_requests (tenant_id, employee_id, start_date, end_date, reason, approved)
		VALUES ($1, $2, $3::date, $4::date, $5, TRUE)`,
		TenantIDFromCtx(ctx), req.EmployeeId, req.StartDate, req.EndDate, req.Reason,
	)
	if err != nil {
		return nil, dbErr(err, "insert time_off_request")
	}
	return &schedulingv1.TimeOffResponse{
		Approved: true,
		Message:  "Time-off request approved.",
	}, nil
}

// GetAvailability returns shifts and approved days-off for an employee within a date range.
func (s *SchedulingServer) GetAvailability(ctx context.Context, req *schedulingv1.GetAvailabilityRequest) (*schedulingv1.GetAvailabilityResponse, error) {
	if req.EmployeeId == "" {
		return nil, status.Error(codes.InvalidArgument, "employee_id is required")
	}
	if req.DateRange == nil {
		return nil, status.Error(codes.InvalidArgument, "date_range is required")
	}

	// Shifts overlapping the range.
	q := dbQ(ctx, s.db)
	shiftRows, err := q.QueryContext(ctx, `
		SELECT id, employee_id,
		       start_time::text, end_time::text,
		       status, notes, created_at::text
		FROM shifts
		WHERE employee_id = $1
		  AND start_time <= $2::timestamptz
		  AND end_time   >= $3::timestamptz
		ORDER BY start_time`,
		req.EmployeeId,
		req.DateRange.EndDate+"T23:59:59Z",
		req.DateRange.StartDate+"T00:00:00Z",
	)
	if err != nil {
		return nil, dbErr(err, "query shifts")
	}
	defer shiftRows.Close()

	var shifts []*schedulingv1.Shift
	for shiftRows.Next() {
		sh, err := scanShiftRows(shiftRows)
		if err != nil {
			return nil, dbErr(err, "scan shift")
		}
		shifts = append(shifts, sh)
	}
	if err := shiftRows.Err(); err != nil {
		return nil, dbErr(err, "rows")
	}

	// Approved days-off within the range (expanded to individual dates by Postgres).
	dayRows, err := q.QueryContext(ctx, `
		SELECT DISTINCT gs::date::text
		FROM time_off_requests,
		     generate_series(start_date, end_date, '1 day'::interval) gs
		WHERE employee_id = $1
		  AND approved     = TRUE
		  AND start_date  <= $3::date
		  AND end_date    >= $2::date
		ORDER BY 1`,
		req.EmployeeId,
		req.DateRange.StartDate,
		req.DateRange.EndDate,
	)
	if err != nil {
		return nil, dbErr(err, "query days_off")
	}
	defer dayRows.Close()

	var daysOff []string
	for dayRows.Next() {
		var d string
		if err := dayRows.Scan(&d); err != nil {
			return nil, dbErr(err, "scan day_off")
		}
		daysOff = append(daysOff, d)
	}
	if err := dayRows.Err(); err != nil {
		return nil, dbErr(err, "rows")
	}

	return &schedulingv1.GetAvailabilityResponse{
		Shifts:  shifts,
		DaysOff: daysOff,
	}, nil
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

func scanShiftRow(row *sql.Row) (*schedulingv1.Shift, error) {
	var sh schedulingv1.Shift
	var st int32
	if err := row.Scan(&sh.Id, &sh.EmployeeId, &sh.StartTime, &sh.EndTime, &st, &sh.Notes, &sh.CreatedAt); err != nil {
		return nil, dbErr(err, "scan shift")
	}
	sh.Status = commonv1.ShiftStatus(st)
	return &sh, nil
}

func scanShiftRows(rows *sql.Rows) (*schedulingv1.Shift, error) {
	var sh schedulingv1.Shift
	var st int32
	err := rows.Scan(&sh.Id, &sh.EmployeeId, &sh.StartTime, &sh.EndTime, &st, &sh.Notes, &sh.CreatedAt)
	if err != nil {
		return nil, err
	}
	sh.Status = commonv1.ShiftStatus(st)
	return &sh, nil
}
