package server

import (
	"context"
	"database/sql"
	"fmt"

	commonv1 "otto/internal/gen/common/v1"
	employeev1 "otto/internal/gen/employee/v1"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// EmployeeServer implements employeev1.EmployeeServiceServer against Postgres.
type EmployeeServer struct {
	employeev1.UnimplementedEmployeeServiceServer
	db *sql.DB
}

// NewEmployeeServer wires up the server with an open database connection.
func NewEmployeeServer(db *sql.DB) *EmployeeServer {
	return &EmployeeServer{db: db}
}

// GetEmployee fetches one employee by UUID (exact) or by name (ILIKE partial).
func (s *EmployeeServer) GetEmployee(ctx context.Context, req *employeev1.GetEmployeeRequest) (*employeev1.Employee, error) {
	const base = `
		SELECT id, name, email, department, worker_type, created_at
		FROM employees
		WHERE %s
		LIMIT 1`

	q := dbQ(ctx, s.db)
	var row *sql.Row
	switch l := req.Lookup.(type) {
	case *employeev1.GetEmployeeRequest_Id:
		row = q.QueryRowContext(ctx, fmt.Sprintf(base, "id = $1"), l.Id)
	case *employeev1.GetEmployeeRequest_Name:
		row = q.QueryRowContext(ctx, fmt.Sprintf(base, "name ILIKE $1"), "%"+l.Name+"%")
	default:
		return nil, status.Error(codes.InvalidArgument, "one of id or name must be provided")
	}

	return scanEmployee(row)
}

// ListEmployees returns all employees, optionally filtered by department and/or worker type.
func (s *EmployeeServer) ListEmployees(ctx context.Context, req *employeev1.ListEmployeesRequest) (*employeev1.ListEmployeesResponse, error) {
	query := `
		SELECT id, name, email, department, worker_type, created_at
		FROM employees
		WHERE TRUE`
	args := []any{}

	if req.Department != nil {
		args = append(args, *req.Department)
		query += fmt.Sprintf(" AND LOWER(department) = LOWER($%d)", len(args))
	}
	if req.WorkerType != nil {
		args = append(args, int32(*req.WorkerType))
		query += fmt.Sprintf(" AND worker_type = $%d", len(args))
	}
	query += " ORDER BY name"

	q := dbQ(ctx, s.db)
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, dbErr(err, "query employees")
	}
	defer rows.Close()

	var employees []*employeev1.Employee
	for rows.Next() {
		e, err := scanEmployeeRow(rows)
		if err != nil {
			return nil, dbErr(err, "scan employee")
		}
		employees = append(employees, e)
	}
	if err := rows.Err(); err != nil {
		return nil, dbErr(err, "rows")
	}

	return &employeev1.ListEmployeesResponse{
		Employees:  employees,
		TotalCount: int32(len(employees)),
	}, nil
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

func scanEmployee(row *sql.Row) (*employeev1.Employee, error) {
	var e employeev1.Employee
	var workerType int32
	var createdAt string
	if err := row.Scan(&e.Id, &e.Name, &e.Email, &e.Department, &workerType, &createdAt); err != nil {
		return nil, dbErr(err, "scan employee")
	}
	e.WorkerType = commonv1.WorkerType(workerType)
	e.CreatedAt = createdAt
	return &e, nil
}

func scanEmployeeRow(rows *sql.Rows) (*employeev1.Employee, error) {
	var e employeev1.Employee
	var workerType int32
	var createdAt string
	err := rows.Scan(&e.Id, &e.Name, &e.Email, &e.Department, &workerType, &createdAt)
	if err != nil {
		return nil, err
	}
	e.WorkerType = commonv1.WorkerType(workerType)
	e.CreatedAt = createdAt
	return &e, nil
}
