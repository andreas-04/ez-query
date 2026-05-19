import { employeeClient, jobClient, payrollClient, schedulingClient, grpcCall } from "../clients";
import {
  WORKER_TYPE,
  JOB_STATUS,
  SHIFT_STATUS,
  WORKER_TYPE_NAMES,
  JOB_STATUS_NAMES,
  SHIFT_STATUS_NAMES,
  PAY_FREQUENCY_NAMES,
} from "../enums";

type PlainObject = Record<string, unknown>;

// ─── Serializers ─────────────────────────────────────────────────────────────
// proto-loader with keepCase:true returns snake_case field names.
// proto-loader with enums:"Number" returns numeric enum values.
// proto-loader with longs:"Number" returns int64 as JS number (no bigint).

function serializeMoney(money?: { amount: number; currency_code: string }): PlainObject | null {
  if (!money) return null;
  return {
    amount_cents: money.amount,
    currency_code: money.currency_code,
    formatted: `${money.currency_code} ${(money.amount / 100).toFixed(2)}`,
  };
}

function serializeEmployee(emp: {
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

function serializeJob(job: {
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

function serializeShift(shift: {
  id: string; employee_id: string; start_time: string; end_time: string;
  status: number; notes: string; created_at: string;
}): PlainObject {
  return {
    id: shift.id,
    employee_id: shift.employee_id,
    start_time: shift.start_time,
    end_time: shift.end_time,
    status: SHIFT_STATUS_NAMES[shift.status] ?? String(shift.status),
    notes: shift.notes || null,
    created_at: shift.created_at,
  };
}

function serializePayRun(run: {
  id: string; employee_id: string; period_start: string; period_end: string;
  gross?: { amount: number; currency_code: string };
  net?: { amount: number; currency_code: string };
  status: string; paid_at: string;
}): PlainObject {
  return {
    id: run.id,
    employee_id: run.employee_id,
    period_start: run.period_start,
    period_end: run.period_end,
    gross: serializeMoney(run.gross),
    net: serializeMoney(run.net),
    status: run.status,
    paid_at: run.paid_at || null,
  };
}

function serializePayRates(r: {
  id: string; employee_id: string; currency_code: string;
  day_rate_cents: number; night_rate_cents: number;
  weekend_rate_cents: number; overtime_rate_cents: number;
  overtime_threshold_hours: number; updated_at: string;
}): PlainObject {
  const fmt = (cents: number) => `${r.currency_code} ${(cents / 100).toFixed(2)}/hr`;
  return {
    id: r.id,
    employee_id: r.employee_id,
    currency_code: r.currency_code,
    day_rate:      { cents: r.day_rate_cents,      formatted: fmt(r.day_rate_cents) },
    night_rate:    { cents: r.night_rate_cents,     formatted: fmt(r.night_rate_cents) },
    weekend_rate:  { cents: r.weekend_rate_cents,   formatted: fmt(r.weekend_rate_cents) },
    overtime_rate: { cents: r.overtime_rate_cents,  formatted: fmt(r.overtime_rate_cents) },
    overtime_threshold_hours: r.overtime_threshold_hours,
    updated_at: r.updated_at,
  };
}

function serializePayPreview(p: {
  employee_id: string; period_start: string; period_end: string;
  regular_day_hours: number; regular_night_hours: number;
  weekend_hours: number; overtime_hours: number;
  day_earnings?: { amount: number; currency_code: string };
  night_earnings?: { amount: number; currency_code: string };
  weekend_earnings?: { amount: number; currency_code: string };
  overtime_earnings?: { amount: number; currency_code: string };
  earned_to_date?: { amount: number; currency_code: string };
  projected_total?: { amount: number; currency_code: string };
  completed_shifts: number; scheduled_shifts: number;
}): PlainObject {
  return {
    employee_id: p.employee_id,
    period_start: p.period_start,
    period_end: p.period_end,
    hours: {
      regular_day:   p.regular_day_hours,
      regular_night: p.regular_night_hours,
      weekend:       p.weekend_hours,
      overtime:      p.overtime_hours,
      total:         Math.round((p.regular_day_hours + p.regular_night_hours + p.weekend_hours + p.overtime_hours) * 100) / 100,
    },
    earnings: {
      day:      serializeMoney(p.day_earnings),
      night:    serializeMoney(p.night_earnings),
      weekend:  serializeMoney(p.weekend_earnings),
      overtime: serializeMoney(p.overtime_earnings),
    },
    earned_to_date: serializeMoney(p.earned_to_date),
    projected_total: serializeMoney(p.projected_total),
    shifts: {
      completed: p.completed_shifts,
      scheduled: p.scheduled_shifts,
    },
  };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function dispatchToolCall(
  name: string,
  input: PlainObject
): Promise<PlainObject> {
  try {
    switch (name) {
      // ── EmployeeService ───────────────────────────────────────────────────

      case "get_employee": {
        // oneof lookup: just set whichever field is provided; proto-loader encodes it correctly
        const req = input.employee_id
          ? { id: input.employee_id }
          : { name: input.employee_name };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const emp = await grpcCall<any>(employeeClient, "GetEmployee", req);
        return serializeEmployee(emp);
      }

      case "list_employees": {
        const req: PlainObject = {};
        if (input.department) req.department = input.department;
        if (input.worker_type) req.worker_type = WORKER_TYPE[input.worker_type as string];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await grpcCall<any>(employeeClient, "ListEmployees", req);
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          employees: (res.employees ?? []).map((e: any) => serializeEmployee(e)),
          total_count: res.total_count,
        };
      }

      // ── JobService ────────────────────────────────────────────────────────

      case "create_job": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const job = await grpcCall<any>(jobClient, "CreateJob", {
          title: input.title,
          description: input.description,
          location: input.location,           // snake_case keys already match proto
          scheduled_start: input.scheduled_start,
          scheduled_end: input.scheduled_end,
        });
        return serializeJob(job);
      }

      case "get_job": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const job = await grpcCall<any>(jobClient, "GetJob", { id: input.job_id });
        return serializeJob(job);
      }

      case "list_jobs": {
        const req: PlainObject = {};
        if (input.employee_id) req.employee_id = input.employee_id;
        if (input.status) req.status = JOB_STATUS[input.status as string];
        if (input.city) req.city = input.city;
        if (input.date_range) req.date_range = input.date_range;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await grpcCall<any>(jobClient, "ListJobs", req);
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          jobs: (res.jobs ?? []).map((j: any) => serializeJob(j)),
          total_count: res.total_count,
        };
      }

      case "assign_employees_to_job": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const job = await grpcCall<any>(jobClient, "AssignEmployees", {
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
        const job = await grpcCall<any>(jobClient, "UpdateJobStatus", req);
        return serializeJob(job);
      }

      case "get_job_location": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loc = await grpcCall<any>(jobClient, "GetJobLocation", { job_id: input.job_id });
        return {
          job_id: loc.job_id,
          address: loc.address,
          coordinates: loc.coordinates,
        };
      }

      // ── PayrollService ────────────────────────────────────────────────────

      case "get_payroll": {
        const req: PlainObject = { employee_id: input.employee_id };
        if (input.pay_period) req.pay_period = input.pay_period;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await grpcCall<any>(payrollClient, "GetPayroll", req);
        return {
          employee_id: res.employee_id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pay_runs: (res.pay_runs ?? []).map((r: any) => serializePayRun(r)),
        };
      }

      case "get_pay_schedule": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = await grpcCall<any>(payrollClient, "GetPaySchedule", {
          employee_id: input.employee_id,
        });
        return {
          id: s.id,
          employee_id: s.employee_id,
          frequency: PAY_FREQUENCY_NAMES[s.frequency] ?? String(s.frequency),
          effective_date: s.effective_date,
          next_pay_date: s.next_pay_date,
        };
      }

      case "list_pay_runs": {
        const req: PlainObject = { employee_id: input.employee_id };
        if (input.status) req.status = input.status;
        if (input.date_range) req.date_range = input.date_range;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await grpcCall<any>(payrollClient, "ListPayRuns", req);
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pay_runs: (res.pay_runs ?? []).map((r: any) => serializePayRun(r)),
          total_count: res.total_count,
        };
      }

      case "get_pay_rates": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await grpcCall<any>(payrollClient, "GetPayRates", {
          employee_id: input.employee_id,
        });
        return serializePayRates(r);
      }

      case "set_pay_rates": {
        const req: PlainObject = {
          employee_id: input.employee_id,
          currency_code: input.currency_code,
          day_rate_cents: input.day_rate_cents,
          night_rate_cents: input.night_rate_cents,
          weekend_rate_cents: input.weekend_rate_cents,
          overtime_rate_cents: input.overtime_rate_cents,
        };
        if (input.overtime_threshold_hours !== undefined) {
          req.overtime_threshold_hours = input.overtime_threshold_hours;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await grpcCall<any>(payrollClient, "SetPayRates", req);
        return serializePayRates(r);
      }

      case "calculate_pay_preview": {
        const req: PlainObject = { employee_id: input.employee_id };
        if (input.date_range) req.date_range = input.date_range;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = await grpcCall<any>(payrollClient, "CalculatePayPreview", req);
        return serializePayPreview(p);
      }

      // ── SchedulingService ─────────────────────────────────────────────────

      case "create_shift": {
        const req: PlainObject = {
          employee_id: input.employee_id,
          start_time: input.start_time,
          end_time: input.end_time,
        };
        if (input.notes) req.notes = input.notes;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shift = await grpcCall<any>(schedulingClient, "CreateShift", req);
        return serializeShift(shift);
      }

      case "get_shift": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shift = await grpcCall<any>(schedulingClient, "GetShift", { id: input.shift_id });
        return serializeShift(shift);
      }

      case "list_shifts": {
        const req: PlainObject = { employee_id: input.employee_id };
        if (input.status) req.status = SHIFT_STATUS[input.status as string];
        if (input.date_range) req.date_range = input.date_range;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await grpcCall<any>(schedulingClient, "ListShifts", req);
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          shifts: (res.shifts ?? []).map((s: any) => serializeShift(s)),
          total_count: res.total_count,
        };
      }

      case "update_shift": {
        const req: PlainObject = { id: input.shift_id };
        if (input.start_time) req.start_time = input.start_time;
        if (input.end_time) req.end_time = input.end_time;
        if (input.status) req.status = SHIFT_STATUS[input.status as string];
        if (input.notes !== undefined) req.notes = input.notes;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shift = await grpcCall<any>(schedulingClient, "UpdateShift", req);
        return serializeShift(shift);
      }

      case "request_time_off": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await grpcCall<any>(schedulingClient, "RequestTimeOff", {
          employee_id: input.employee_id,
          start_date: input.start_date,
          end_date: input.end_date,
          reason: input.reason,
        });
        return { approved: res.approved, message: res.message };
      }

      case "get_availability": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await grpcCall<any>(schedulingClient, "GetAvailability", {
          employee_id: input.employee_id,
          date_range: input.date_range,
        });
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          shifts: (res.shifts ?? []).map((s: any) => serializeShift(s)),
          days_off: res.days_off ?? [],
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    if (e instanceof Error) {
      return { error: e.message };
    }
    return { error: "An unexpected error occurred" };
  }
}
