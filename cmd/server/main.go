package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"

	employeev1 "otto/internal/gen/employee/v1"
	jobv1 "otto/internal/gen/job/v1"
	"otto/internal/gen/mcpserver"
	payrollv1 "otto/internal/gen/payroll/v1"
	schedulingv1 "otto/internal/gen/scheduling/v1"
	"otto/internal/server"

	_ "github.com/lib/pq"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/reflection"
)

func main() {
	// -----------------------------------------------------------------------
	// Configuration from environment
	// -----------------------------------------------------------------------
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	grpcAddr := os.Getenv("GRPC_ADDR")
	if grpcAddr == "" {
		grpcAddr = ":50051"
	}

	mcpAddr := os.Getenv("MCP_ADDR")
	if mcpAddr == "" {
		mcpAddr = ":8080"
	}

	// -----------------------------------------------------------------------
	// Database
	// -----------------------------------------------------------------------
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("ping db: %v", err)
	}
	log.Println("connected to postgres")

	// -----------------------------------------------------------------------
	// gRPC server
	// -----------------------------------------------------------------------
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(server.TenantInterceptor(db)),
	)

	employeev1.RegisterEmployeeServiceServer(grpcServer, server.NewEmployeeServer(db))
	payrollv1.RegisterPayrollServiceServer(grpcServer, server.NewPayrollServer(db))
	schedulingv1.RegisterSchedulingServiceServer(grpcServer, server.NewSchedulingServer(db))
	jobv1.RegisterJobServiceServer(grpcServer, server.NewJobServer(db))

	// Server reflection lets tools like grpcurl discover services at runtime.
	reflection.Register(grpcServer)

	lis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		log.Fatalf("listen %s: %v", grpcAddr, err)
	}
	fmt.Printf("gRPC server listening on %s\n", grpcAddr)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// -----------------------------------------------------------------------
	// MCP server
	//
	// MCP tools dial back into our own gRPC server rather than calling the
	// service impls directly. The round trip is essential: Postgres RLS
	// requires the per-tx app.tenant_id GUC set by TenantInterceptor, and
	// a direct in-process call would skip it (every RLS-bound query would
	// return zero rows). The dial uses insecure creds because the listener
	// is loopback-only from this process's perspective.
	// -----------------------------------------------------------------------
	grpcConn, err := grpc.NewClient(localDialAddr(grpcAddr),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		log.Fatalf("dial local gRPC: %v", err)
	}
	defer grpcConn.Close()

	mcpSrv := mcpserver.NewServer()
	employeev1.RegisterEmployeeServiceTools(mcpSrv, employeev1.NewEmployeeServiceClient(grpcConn))
	jobv1.RegisterJobServiceTools(mcpSrv, jobv1.NewJobServiceClient(grpcConn))
	payrollv1.RegisterPayrollServiceTools(mcpSrv, payrollv1.NewPayrollServiceClient(grpcConn))
	schedulingv1.RegisterSchedulingServiceTools(mcpSrv, schedulingv1.NewSchedulingServiceClient(grpcConn))

	// -----------------------------------------------------------------------
	// Run both servers; first error or signal triggers graceful shutdown.
	// -----------------------------------------------------------------------
	errCh := make(chan error, 2)
	go func() {
		if err := grpcServer.Serve(lis); err != nil {
			errCh <- fmt.Errorf("gRPC serve: %w", err)
		}
	}()
	go func() {
		fmt.Printf("MCP server listening on %s\n", mcpAddr)
		if err := mcpserver.ServeHTTP(ctx, mcpSrv, mcpAddr); err != nil {
			errCh <- fmt.Errorf("MCP serve: %w", err)
		}
	}()

	select {
	case <-ctx.Done():
		log.Println("shutdown signal received")
	case err := <-errCh:
		log.Printf("server error: %v", err)
		stop() // cancels ctx so MCP HTTP shuts down too
	}

	grpcServer.GracefulStop()
	log.Println("shutdown complete")
}

// localDialAddr converts a listen-style address like ":50051" into a dialable
// "localhost:50051". Bare host:port values are returned unchanged.
func localDialAddr(addr string) string {
	if strings.HasPrefix(addr, ":") {
		return "localhost" + addr
	}
	return addr
}
