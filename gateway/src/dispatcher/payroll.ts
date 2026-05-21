import { payrollClient, grpcCallWithMeta } from "../clients";
import { PAY_FREQUENCY_NAMES } from "../enums";

type PlainObject = Record<string, unknown>;

export function serializeMoney(money?: { amount: number; currency_code: string }): PlainObject | null {
  if (!money) return null;
  return {
    amount_cents: money.amount,
    currency_code: money.currency_code,
    formatted: `${money.currency_code} ${(money.amount / 100).toFixed(2)}`,
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
    earned_to_date:  serializeMoney(p.earned_to_date),
    projected_total: serializeMoney(p.projected_total),
    shifts: {
      completed: p.completed_shifts,
      scheduled: p.scheduled_shifts,
    },
  };
}

export async function dispatchPayroll(
  name: string,
  input: PlainObject,
  tenantId: string,
): Promise<PlainObject> {
  const meta = { "x-tenant-id": tenantId };
  const call = <T>(client: unknown, method: string, req: object) =>
    grpcCallWithMeta<T>(client, method, req, meta);

  switch (name) {
    case "get_payroll": {
      const req: PlainObject = { employee_id: input.employee_id };
      if (input.pay_period) req.pay_period = input.pay_period;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await call<any>(payrollClient, "GetPayroll", req);
      return {
        employee_id: res.employee_id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pay_runs: (res.pay_runs ?? []).map((r: any) => serializePayRun(r)),
      };
    }

    case "get_pay_schedule": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = await call<any>(payrollClient, "GetPaySchedule", {
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
      const res = await call<any>(payrollClient, "ListPayRuns", req);
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pay_runs: (res.pay_runs ?? []).map((r: any) => serializePayRun(r)),
        total_count: res.total_count,
      };
    }

    case "get_pay_rates": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await call<any>(payrollClient, "GetPayRates", {
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
      const r = await call<any>(payrollClient, "SetPayRates", req);
      return serializePayRates(r);
    }

    case "calculate_pay_preview": {
      const req: PlainObject = { employee_id: input.employee_id };
      if (input.date_range) req.date_range = input.date_range;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = await call<any>(payrollClient, "CalculatePayPreview", req);
      return serializePayPreview(p);
    }

    default:
      throw new Error(`Unknown payroll tool: ${name}`);
  }
}
