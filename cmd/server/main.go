package main

import (
	"database/sql"
	"fmt"
	"log"
	"net"
	"os"

	employeev1 "otto/internal/gen/employee/v1"
	jobv1 "otto/internal/gen/job/v1"
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

	addr := os.Getenv("GRPC_ADDR")
	if addr == "" {
		addr = ":50051"
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
	grpcServer := grpc.NewServer()

	employeev1.RegisterEmployeeServiceServer(grpcServer, server.NewEmployeeServer(db))
	payrollv1.RegisterPayrollServiceServer(grpcServer, server.NewPayrollServer(db))
	schedulingv1.RegisterSchedulingServiceServer(grpcServer, server.NewSchedulingServer(db))
	jobv1.RegisterJobServiceServer(grpcServer, server.NewJobServer(db))

	// Server reflection lets tools like grpcurl discover services at runtime.
	reflection.Register(grpcServer)

	// -----------------------------------------------------------------------
	// Listen
	// -----------------------------------------------------------------------
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen %s: %v", addr, err)
	}
	fmt.Printf("gRPC server listening on %s\n", addr)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
