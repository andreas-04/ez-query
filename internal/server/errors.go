package server

import (
	"database/sql"
	"errors"

	"github.com/lib/pq"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// dbErr maps a database error to an appropriate gRPC status. It exists so
// every handler can wrap Scan/Exec/Query errors with one call instead of
// hand-classifying pq error codes, and so client-shape problems (bad UUIDs,
// FK violations) come back as InvalidArgument/AlreadyExists/NotFound rather
// than a generic Internal that leaks the raw driver message.
//
// op is a short label for the operation ("scan employee", "insert job", …)
// and is prepended to the surfaced message.
func dbErr(err error, op string) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return status.Errorf(codes.NotFound, "%s: not found", op)
	}
	var pe *pq.Error
	if errors.As(err, &pe) {
		switch pe.Code {
		case "22P02": // invalid_text_representation — bad UUID/enum literal
			return status.Errorf(codes.InvalidArgument, "%s: %s", op, pe.Message)
		case "22007", "22008": // invalid datetime / datetime field overflow
			return status.Errorf(codes.InvalidArgument, "%s: %s", op, pe.Message)
		case "23502": // not_null_violation
			return status.Errorf(codes.InvalidArgument, "%s: %s", op, pe.Message)
		case "23503": // foreign_key_violation
			return status.Errorf(codes.FailedPrecondition, "%s: %s", op, pe.Message)
		case "23505": // unique_violation
			return status.Errorf(codes.AlreadyExists, "%s: %s", op, pe.Message)
		case "23514": // check_violation
			return status.Errorf(codes.InvalidArgument, "%s: %s", op, pe.Message)
		}
	}
	return status.Errorf(codes.Internal, "%s: %v", op, err)
}
