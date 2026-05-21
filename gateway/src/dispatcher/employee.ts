import { employeeClient, grpcCallWithMeta } from "../clients";
import { WORKER_TYPE, WORKER_TYPE_NAMES } from "../enums";

type PlainObject = Record<string, unknown>;

export function serializeEmployee(emp: {
  id: string; name: string; email: string; department: string;
  worker_type: number; created_at: string;
}): PlainObject {
  return {
    id: emp.id,
    name: emp.name,
    email: emp.email,
    department: emp.department,
    worker_type: WORKER_TYPE_NAMES[emp.worker_type] ?? String(emp.worker_type),
    created_at: emp.created_at,
  };
}

export async function dispatchEmployee(
  name: string,
  input: PlainObject,
  tenantId: string,
): Promise<PlainObject> {
  const meta = { "x-tenant-id": tenantId };
  const call = <T>(client: unknown, method: string, req: object) =>
    grpcCallWithMeta<T>(client, method, req, meta);

  switch (name) {
    case "get_employee": {
      const req = input.employee_id
        ? { id: input.employee_id }
        : { name: input.employee_name };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emp = await call<any>(employeeClient, "GetEmployee", req);
      return serializeEmployee(emp);
    }

    case "list_employees": {
      const req: PlainObject = {};
      if (input.department) req.department = input.department;
      if (input.worker_type) req.worker_type = WORKER_TYPE[input.worker_type as string];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await call<any>(employeeClient, "ListEmployees", req);
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        employees: (res.employees ?? []).map((e: any) => serializeEmployee(e)),
        total_count: res.total_count,
      };
    }

    default:
      throw new Error(`Unknown employee tool: ${name}`);
  }
}
