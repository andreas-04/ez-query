import type { Tool } from "./types";
import { dateRangeSchema } from "./types";

export const schedulingTools: Tool[] = [
  {
    name: "create_shift",
    description:
      "Book a new office or non-field shift for an employee. Use when the user says " +
      "'schedule Alice for Tuesday 9–5', 'book a shift for Bob next Friday', or 'add a shift'. " +
      "Requires employee_id — resolve the employee name first.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee" },
        start_time: {
          type: "string",
          description: "ISO 8601 timestamp for shift start, e.g. '2024-03-19T09:00:00Z'",
        },
        end_time: {
          type: "string",
          description: "ISO 8601 timestamp for shift end, e.g. '2024-03-19T17:00:00Z'",
        },
        notes: { type: "string", description: "Optional free-text notes to attach to the shift" },
      },
      required: ["employee_id", "start_time", "end_time"],
    },
  },
  {
    name: "get_shift",
    description: "Retrieve a single shift record by its UUID.",
    input_schema: {
      type: "object",
      properties: {
        shift_id: { type: "string", description: "UUID of the shift" },
      },
      required: ["shift_id"],
    },
  },
  {
    name: "list_shifts",
    description:
      "List shifts for an employee with optional date range and status filters. " +
      "Use when the user asks 'what shifts does Alice have this week', " +
      "'show me all missed shifts', or 'list Bob's schedule for March'.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee" },
        date_range: dateRangeSchema,
        status: {
          type: "string",
          enum: ["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"],
          description: "Filter by shift status",
        },
      },
      required: ["employee_id"],
    },
  },
  {
    name: "update_shift",
    description:
      "Partially update a shift — reschedule it, change its status, or update notes. " +
      "Only the fields you provide are modified. Use when the user says 'mark Alice's shift as missed', " +
      "'reschedule Bob's Monday shift to Tuesday', or 'cancel this shift'.",
    input_schema: {
      type: "object",
      properties: {
        shift_id: { type: "string", description: "UUID of the shift to update" },
        start_time: {
          type: "string",
          description: "New ISO 8601 start timestamp if rescheduling",
        },
        end_time: {
          type: "string",
          description: "New ISO 8601 end timestamp if rescheduling",
        },
        status: {
          type: "string",
          enum: ["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"],
          description: "New status to transition the shift to",
        },
        notes: {
          type: "string",
          description: "Replacement notes; an empty string clears existing notes",
        },
      },
      required: ["shift_id"],
    },
  },
  {
    name: "request_time_off",
    description:
      "Submit a time-off / leave request for an employee. Use when the user says " +
      "'request vacation for Alice from June 1 to June 5', 'Bob needs sick leave Monday', " +
      "or 'put in a leave request'. Requires employee_id — resolve the employee name first.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee requesting leave" },
        start_date: {
          type: "string",
          description: "First day of leave in YYYY-MM-DD format",
        },
        end_date: {
          type: "string",
          description: "Last day of leave in YYYY-MM-DD format",
        },
        reason: {
          type: "string",
          description: "Human-readable reason, e.g. 'Annual leave' or 'Sick day'",
        },
      },
      required: ["employee_id", "start_date", "end_date", "reason"],
    },
  },
  {
    name: "get_availability",
    description:
      "Get an employee's working calendar — all scheduled shifts and approved days off within a " +
      "date range. Use when the user asks 'is Alice available next week', " +
      "'what does Bob's schedule look like in June', or 'who is off on March 15'.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID of the employee" },
        date_range: {
          type: "object",
          properties: {
            start_date: { type: "string", description: "Range start in YYYY-MM-DD format" },
            end_date: { type: "string", description: "Range end in YYYY-MM-DD format" },
          },
          required: ["start_date", "end_date"],
        },
      },
      required: ["employee_id", "date_range"],
    },
  },
];
