import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";

// Proto directory is two levels above gateway/src/
const PROTO_DIR = path.resolve(__dirname, "../../proto");

const LOAD_OPTIONS: protoLoader.Options = {
  keepCase: true,    // snake_case field names — matches proto definitions and tool input schema
  longs: "Number",   // proto int64 → JS number (avoids bigint JSON serialization issues)
  enums: "Number",   // proto enum → number (we map to human-readable strings in serializers)
  defaults: true,    // include default values in responses
  oneofs: true,      // add a virtual discriminator field for oneof groups
  includeDirs: [PROTO_DIR],
};

function makeClient(protoFile: string, serviceFqn: string): grpc.Client {
  const def = protoLoader.loadSync(path.join(PROTO_DIR, protoFile), LOAD_OPTIONS);
  const pkg = grpc.loadPackageDefinition(def);
  // Navigate dotted FQN to the service constructor, e.g. "workforce.employee.v1.EmployeeService"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Svc = serviceFqn.split(".").reduce((o, k) => (o as any)[k], pkg) as any;
  const host = (process.env.GRPC_BASE_URL ?? "http://localhost:50051").replace(/^https?:\/\//, "");
  return new Svc(host, grpc.credentials.createInsecure());
}

export const employeeClient = makeClient("employee/v1/employee.proto", "workforce.employee.v1.EmployeeService");
export const jobClient       = makeClient("job/v1/job.proto",           "workforce.job.v1.JobService");
export const payrollClient   = makeClient("payroll/v1/payroll.proto",   "workforce.payroll.v1.PayrollService");
export const schedulingClient = makeClient("scheduling/v1/scheduling.proto", "workforce.scheduling.v1.SchedulingService");

/** Promisify a single unary gRPC call. Rejects with the gRPC ServiceError on failure. */
export function grpcCall<T = Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  method: string,
  request: object
): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](request, (err: Error | null, response: T) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}
