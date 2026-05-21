import { jobClient, grpcCallWithMeta } from "../clients";
import { JOB_STATUS, JOB_STATUS_NAMES } from "../enums";

type PlainObject = Record<string, unknown>;

export function serializeJob(job: {
  id: string; title: string; description: string; status: number;
  location?: unknown; scheduled_start: string; scheduled_end: string;
  actual_start: string; actual_end: string;
  assigned_employee_ids: string[]; created_at: string;
}): PlainObject {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    status: JOB_STATUS_NAMES[job.status] ?? String(job.status),
    location: job.location,
    scheduled_start: job.scheduled_start,
    scheduled_end: job.scheduled_end,
    actual_start: job.actual_start || null,
    actual_end: job.actual_end || null,
    assigned_employee_ids: job.assigned_employee_ids,
    created_at: job.created_at,
  };
}

export async function dispatchJob(
  name: string,
  input: PlainObject,
  tenantId: string,
): Promise<PlainObject> {
  const meta = { "x-tenant-id": tenantId };
  const call = <T>(client: unknown, method: string, req: object) =>
    grpcCallWithMeta<T>(client, method, req, meta);

  switch (name) {
    case "create_job": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job = await call<any>(jobClient, "CreateJob", {
        title: input.title,
        description: input.description,
        location: input.location,
        scheduled_start: input.scheduled_start,
        scheduled_end: input.scheduled_end,
      });
      return serializeJob(job);
    }

    case "get_job": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job = await call<any>(jobClient, "GetJob", { id: input.job_id });
      return serializeJob(job);
    }

    case "list_jobs": {
      const req: PlainObject = {};
      if (input.employee_id) req.employee_id = input.employee_id;
      if (input.status) req.status = JOB_STATUS[input.status as string];
      if (input.city) req.city = input.city;
      if (input.date_range) req.date_range = input.date_range;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await call<any>(jobClient, "ListJobs", req);
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        jobs: (res.jobs ?? []).map((j: any) => serializeJob(j)),
        total_count: res.total_count,
      };
    }

    case "assign_employees_to_job": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job = await call<any>(jobClient, "AssignEmployees", {
        job_id: input.job_id,
        employee_ids: input.employee_ids,
      });
      return serializeJob(job);
    }

    case "update_job_status": {
      const req: PlainObject = {
        job_id: input.job_id,
        status: JOB_STATUS[input.status as string],
      };
      if (input.actual_start) req.actual_start = input.actual_start;
      if (input.actual_end) req.actual_end = input.actual_end;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job = await call<any>(jobClient, "UpdateJobStatus", req);
      return serializeJob(job);
    }

    case "get_job_location": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loc = await call<any>(jobClient, "GetJobLocation", { job_id: input.job_id });
      return {
        job_id: loc.job_id,
        address: loc.address,
        coordinates: loc.coordinates,
      };
    }

    default:
      throw new Error(`Unknown job tool: ${name}`);
  }
}
