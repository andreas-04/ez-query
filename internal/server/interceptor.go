package server

import (
	"context"
	"database/sql"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// querier is satisfied by both *sql.DB and *sql.Tx, allowing handlers to
// operate transparently whether they are inside a transaction or not.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// devTenantID is the deterministic UUID inserted by seed.sql for local
// development. Used when SKIP_AUTH_INTERCEPTOR=true.
const devTenantID = "00000000-0000-0000-0000-000000000001"

// ── Context keys ─────────────────────────────────────────────────────────────

type txContextKey struct{}
type tenantIDContextKey struct{}

func withTx(ctx context.Context, tx *sql.Tx) context.Context {
	return context.WithValue(ctx, txContextKey{}, tx)
}

// dbQ returns the *sql.Tx stored in ctx if one exists (set by TenantInterceptor),
// otherwise falls back to the provided connection pool. Handlers call this once
// at the top of each method so they never touch the pool directly.
func dbQ(ctx context.Context, pool *sql.DB) querier {
	if tx, ok := ctx.Value(txContextKey{}).(*sql.Tx); ok && tx != nil {
		return tx
	}
	return pool
}

// WithTenantID stores the resolved tenant UUID in ctx.
func WithTenantID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, tenantIDContextKey{}, id)
}

// TenantIDFromCtx retrieves the tenant UUID from ctx. Returns "" if not set.
func TenantIDFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(tenantIDContextKey{}).(string)
	return v
}

// ── Interceptor ──────────────────────────────────────────────────────────────

// TenantInterceptor returns a gRPC unary server interceptor that:
//  1. Reads the "x-tenant-id" gRPC metadata header.
//  2. Opens a *sql.Tx and runs SET LOCAL via set_config so the session-local
//     GUC app.tenant_id is set for the duration of the request.
//  3. Stores the tx and tenant ID in ctx for handlers to consume.
//  4. Commits on success, rolls back on handler error.
//
// Set SKIP_AUTH_INTERCEPTOR=true in the environment to bypass the header check
// and use devTenantID instead. This keeps the TUI / local dev tools working
// without real Clerk tokens.
func TenantInterceptor(db *sql.DB) grpc.UnaryServerInterceptor {
	skipAuth := os.Getenv("SKIP_AUTH_INTERCEPTOR") == "true"

	return func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		tenantID := devTenantID

		if !skipAuth {
			md, _ := metadata.FromIncomingContext(ctx)
			vals := md.Get("x-tenant-id")
			if len(vals) == 0 || vals[0] == "" {
				return nil, status.Error(codes.Unauthenticated, "missing x-tenant-id metadata")
			}
			tenantID = vals[0]
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
		}

		// set_config(key, value, is_local=true) scopes the GUC to this
		// transaction. It resets automatically on COMMIT or ROLLBACK, which
		// makes it safe with connection poolers like pgBouncer.
		if _, err := tx.ExecContext(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenantID); err != nil {
			tx.Rollback() //nolint:errcheck
			return nil, status.Errorf(codes.Internal, "set tenant GUC: %v", err)
		}

		ctx = withTx(ctx, tx)
		ctx = WithTenantID(ctx, tenantID)

		resp, handlerErr := handler(ctx, req)
		if handlerErr != nil {
			tx.Rollback() //nolint:errcheck
			return nil, handlerErr
		}

		if err := tx.Commit(); err != nil {
			return nil, status.Errorf(codes.Internal, "commit tx: %v", err)
		}
		return resp, nil
	}
}
