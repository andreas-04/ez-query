import type { Tool } from "./types";
import { dateRangeSchema } from "./types";

export const payrollTools: Tool[] = [
  {
    name: "get_payroll",
    description:
      "Get pay run records for an employee. Use when the user asks 'what did Alice get paid last month', " +
      "'show me Bob's Q1 payroll', or 'what's the latest paycheck for this employee'. " +
      "Always resolve the employee name to an employee_id before calling this.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee" },
        pay_period: {
          type: "string",
          description:
            "Period selector: 'latest', a quarter like '2024-Q1', or an ISO date like '2024-03-01'. " +
            "Leave empty to return all pay runs.",
        },
      },
      required: ["employee_id"],
    },
  },
  {
    name: "get_pay_schedule",
    description:
      "Get the active pay schedule for an employee — pay frequency and next pay date. " +
      "Use when the user asks 'when does Sarah get paid next', 'is Bob on weekly or monthly pay', " +
      "or 'what's Alice's pay schedule'.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee" },
      },
      required: ["employee_id"],
    },
  },
  {
    name: "list_pay_runs",
    description:
      "List pay run history for an employee with optional date range and status filters. " +
      "Use when the user asks 'show all processed payments for Alice this year', " +
      "'list pending pay runs', or needs a full disbursement history.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee" },
        date_range: dateRangeSchema,
        status: {
          type: "string",
          enum: ["pending", "processed", "paid"],
          description: "Filter by pay run status",
        },
      },
      required: ["employee_id"],
    },
  },
  {
    name: "get_pay_rates",
    description:
      "Retrieve the hourly rate card for an employee — day rate, night rate, weekend rate, " +
      "overtime rate, and the weekly overtime threshold. Use when the user asks " +
      "'what is Alice's hourly rate', 'what does Bob earn for night shifts', or " +
      "'show me the pay rates for this employee'.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee" },
      },
      required: ["employee_id"],
    },
  },
  {
    name: "set_pay_rates",
    description:
      "Create or update the hourly rate card for an employee. Use when the user says " +
      "'set Alice's day rate to $55/hr', 'update Bob's overtime rate', or " +
      "'configure pay rates for this employee'. All rate values are in whole cents (e.g. 5500 = $55.00/hr).",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee" },
        currency_code: { type: "string", description: "ISO 4217 currency code, e.g. 'USD'" },
        day_rate_cents: {
          type: "number",
          description: "Weekday daytime rate (06:00–18:00 UTC) in cents per hour, e.g. 5500 for $55/hr",
        },
        night_rate_cents: {
          type: "number",
          description: "Weekday night rate (18:00–06:00 UTC) in cents per hour",
        },
        weekend_rate_cents: {
          type: "number",
          description: "Saturday & Sunday rate in cents per hour",
        },
        overtime_rate_cents: {
          type: "number",
          description: "Rate for weekday hours above the weekly threshold, in cents per hour",
        },
        overtime_threshold_hours: {
          type: "number",
          description: "Weekly hour threshold before overtime kicks in; defaults to 40",
        },
      },
      required: ["employee_id", "currency_code", "day_rate_cents", "night_rate_cents", "weekend_rate_cents", "overtime_rate_cents"],
    },
  },
  {
    name: "calculate_pay_preview",
    description:
      "Calculate a real-time pay breakdown for an employee across a date range. " +
      "Applies day, night, weekend, and overtime rates to each logged shift and returns " +
      "hours by category, earnings by category, total earned from completed shifts, and a " +
      "projected total including scheduled future shifts. " +
      "Use when the user asks 'how much has Alice earned this month', " +
      "'what will Bob's pay be by end of month', 'show me a pay breakdown for this week', " +
      "or 'calculate predictive payroll for Emma'. Defaults to the current calendar month if no " +
      "date range is given. Requires pay rates to be configured first.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee" },
        date_range: {
          ...dateRangeSchema,
          description: "Period to calculate. Omit to default to the current calendar month.",
        },
      },
      required: ["employee_id"],
    },
  },
];
