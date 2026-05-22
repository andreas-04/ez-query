package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	employeev1 "otto/internal/gen/employee/v1"
	jobv1 "otto/internal/gen/job/v1"
	"otto/internal/gen/mcpserver"
	payrollv1 "otto/internal/gen/payroll/v1"
	schedulingv1 "otto/internal/gen/scheduling/v1"
	"otto/internal/server"

	_ "github.com/lib/pq"
	"google.golang.org/grpc"
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
	// Service implementations (shared by gRPC and MCP)
	// -----------------------------------------------------------------------
	empSrv := server.NewEmployeeServer(db)
	jobSrv := server.NewJobServer(db)
	payrollSrv := server.NewPayrollServer(db)
	schedulingSrv := server.NewSchedulingServer(db)

	// -----------------------------------------------------------------------
	// gRPC server
	// -----------------------------------------------------------------------
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(server.TenantInterceptor(db)),
	)

	employeev1.RegisterEmployeeServiceServer(grpcServer, empSrv)
	payrollv1.RegisterPayrollServiceServer(grpcServer, payrollSrv)
	schedulingv1.RegisterSchedulingServiceServer(grpcServer, schedulingSrv)
	jobv1.RegisterJobServiceServer(grpcServer, jobSrv)

	// Server reflection lets tools like grpcurl discover services at runtime.
	reflection.Register(grpcServer)

	lis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		log.Fatalf("listen %s: %v", grpcAddr, err)
	}
	fmt.Printf("gRPC server listening on %s\n", grpcAddr)
	go func() {
		if err := grpcServer.Serve(lis); err != nil {
			log.Fatalf("gRPC serve: %v", err)
		}
	}()

	// -----------------------------------------------------------------------
	// MCP server (generated tools — one per unary RPC)
	// -----------------------------------------------------------------------
	mcpSrv := mcpserver.NewServer()
	employeev1.RegisterEmployeeServiceTools(mcpSrv, employeev1.NewLocalEmployeeServiceClient(empSrv))
	jobv1.RegisterJobServiceTools(mcpSrv, jobv1.NewLocalJobServiceClient(jobSrv))
	payrollv1.RegisterPayrollServiceTools(mcpSrv, payrollv1.NewLocalPayrollServiceClient(payrollSrv))
	schedulingv1.RegisterSchedulingServiceTools(mcpSrv, schedulingv1.NewLocalSchedulingServiceClient(schedulingSrv))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	fmt.Printf("MCP server listening on %s\n", mcpAddr)
	if err := mcpserver.ServeHTTP(ctx, mcpSrv, mcpAddr); err != nil {
		log.Fatalf("MCP serve: %v", err)
	}
}
