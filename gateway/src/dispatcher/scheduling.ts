import { schedulingClient, grpcCallWithMeta } from "../clients";
import { SHIFT_STATUS, SHIFT_STATUS_NAMES } from "../enums";

type PlainObject = Record<string, unknown>;

export function serializeShift(shift: {
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

export async function dispatchScheduling(
  name: string,
  input: PlainObject,
  tenantId: string,
): Promise<PlainObject> {
  const meta = { "x-tenant-id": tenantId };
  const call = <T>(client: unknown, method: string, req: object) =>
    grpcCallWithMeta<T>(client, method, req, meta);

  switch (name) {
    case "create_shift": {
      const req: PlainObject = {
        employee_id: input.employee_id,
        start_time: input.start_time,
        end_time: input.end_time,
      };
      if (input.notes) req.notes = input.notes;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shift = await call<any>(schedulingClient, "CreateShift", req);
      return serializeShift(shift);
    }

    case "get_shift": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shift = await call<any>(schedulingClient, "GetShift", { id: input.shift_id });
      return serializeShift(shift);
    }

    case "list_shifts": {
      const req: PlainObject = { employee_id: input.employee_id };
      if (input.status) req.status = SHIFT_STATUS[input.status as string];
      if (input.date_range) req.date_range = input.date_range;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await call<any>(schedulingClient, "ListShifts", req);
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
      const shift = await call<any>(schedulingClient, "UpdateShift", req);
      return serializeShift(shift);
    }

    case "request_time_off": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await call<any>(schedulingClient, "RequestTimeOff", {
        employee_id: input.employee_id,
        start_date: input.start_date,
        end_date: input.end_date,
        reason: input.reason,
      });
      return { approved: res.approved, message: res.message };
    }

    case "get_availability": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await call<any>(schedulingClient, "GetAvailability", {
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
      throw new Error(`Unknown scheduling tool: ${name}`);
  }
}
