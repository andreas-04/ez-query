// Tool definition shape expected by the Anthropic Messages API
interface InputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

interface Tool {
  name: string;
  description: string;
  input_schema: InputSchema;
}

const addressSchema = {
  type: "object" as const,
  properties: {
    line1: { type: "string", description: "Primary street line, e.g. '123 Main St'" },
    line2: { type: "string", description: "Optional secondary line, e.g. 'Suite 400'" },
    city: { type: "string" },
    state: { type: "string", description: "State, province, or region code" },
    postcode: { type: "string", description: "Postal / ZIP code" },
    country: { type: "string", description: "ISO 3166-1 alpha-2 country code, e.g. 'US'" },
  },
  required: ["line1", "city", "state", "postcode", "country"],
};

const dateRangeSchema = {
  type: "object" as const,
  properties: {
    start_date: { type: "string", description: "Inclusive start date in YYYY-MM-DD format" },
    end_date: { type: "string", description: "Inclusive end date in YYYY-MM-DD format" },
  },
  required: ["start_date", "end_date"],
};

export const tools: Tool[] = [
  // ─── EmployeeService ────────────────────────────────────────────────────────
  {
    name: "get_employee",
    description:
      "Look up a single employee by their UUID or by name (fuzzy, case-insensitive match). " +
      "Always call this first whenever the user mentions an employee by name before using any " +
      "tool that requires an employee_id, such as get_payroll, create_shift, or get_availability. " +
      "Examples: 'find Alice', 'who is employee ID abc-123', 'look up Bob Smith'.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "Exact UUID of the employee" },
        employee_name: {
          type: "string",
          description: "Full or partial name to search for (case-insensitive ILIKE match)",
        },
      },
    },
  },
  {
    name: "list_employees",
    description:
      "List all employees, optionally filtered by department or worker type. " +
      "Use when the user asks 'who works in engineering', 'show me all field workers', " +
      "'list the whole team', or 'how many office staff do we have'.",
    input_schema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          description: "Filter by department name, e.g. 'Engineering'",
        },
        worker_type: {
          type: "string",
          enum: ["OFFICE", "FIELD", "MIXED"],
          description: "Filter by how the employee primarily works",
        },
      },
    },
  },

  // ─── JobService ─────────────────────────────────────────────────────────────
  {
    name: "create_job",
    description:
      "Create a new field job with a location, title, description, and scheduled time window. " +
      "Use when the user says 'book a job', 'create a new job for tomorrow', or " +
      "'schedule a site visit at 14 Oak Street'. Employees are assigned separately with assign_employees_to_job.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short descriptive title, e.g. 'HVAC Inspection – Building B'",
        },
        description: {
          type: "string",
          description: "Detailed description of the work to be performed",
        },
        location: addressSchema,
        scheduled_start: {
          type: "string",
          description: "ISO 8601 timestamp for planned start, e.g. '2024-03-15T09:00:00Z'",
        },
        scheduled_end: {
          type: "string",
          description: "ISO 8601 timestamp for planned end, e.g. '2024-03-15T17:00:00Z'",
        },
      },
      required: ["title", "description", "location", "scheduled_start", "scheduled_end"],
    },
  },
  {
    name: "get_job",
    description:
      "Retrieve a single job record by its UUID. Use when you have a specific job_id " +
      "and need its full details.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "UUID of the job" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "list_jobs",
    description:
      "List jobs with optional filters. Use when the user asks 'show me all scheduled jobs', " +
      "'what jobs is Alice working on', 'jobs in Chicago this week', or 'any cancelled jobs recently'. " +
      "Resolve the employee name to an employee_id first if filtering by employee.",
    input_schema: {
      type: "object",
      properties: {
        employee_id: {
          type: "string",
          description: "Filter to jobs assigned to this employee UUID",
        },
        date_range: dateRangeSchema,
        status: {
          type: "string",
          enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETE", "CANCELLED"],
          description: "Filter by job lifecycle status",
        },
        city: { type: "string", description: "Filter by job site city (exact match)" },
      },
    },
  },
  {
    name: "assign_employees_to_job",
    description:
      "Assign one or more employees to an existing job. This is additive — existing assignments " +
      "are preserved. Use when the user says 'add Bob to this job', 'assign Sarah and Tom to job XYZ', " +
      "or 'put Alice on the HVAC inspection'. Resolve employee names to IDs first.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "UUID of the job" },
        employee_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUIDs of the employees to add to the job",
        },
      },
      required: ["job_id", "employee_ids"],
    },
  },
  {
    name: "update_job_status",
    description:
      "Transition a job to a new lifecycle status. Use when the user says 'mark job as started', " +
      "'complete the HVAC job', or 'cancel tomorrow's site visit'. " +
      "Provide actual_start when moving to IN_PROGRESS; provide actual_end when moving to COMPLETE.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "UUID of the job to update" },
        status: {
          type: "string",
          enum: ["SCHEDULED", "IN_PROGRESS", "COMPLETE", "CANCELLED"],
          description: "New lifecycle status",
        },
        actual_start: {
          type: "string",
          description: "ISO 8601 timestamp when work actually started; set when moving to IN_PROGRESS",
        },
        actual_end: {
          type: "string",
          description: "ISO 8601 timestamp when work actually finished; set when moving to COMPLETE",
        },
      },
      required: ["job_id", "status"],
    },
  },
  {
    name: "get_job_location",
    description:
      "Get the address and GPS coordinates for a job site. Use when the user asks " +
      "'where is this job', 'what's the address for job XYZ', or needs routing information.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "UUID of the job" },
      },
      required: ["job_id"],
    },
  },

  // ─── PayrollService ──────────────────────────────────────────────────────────
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

  // ─── SchedulingService ───────────────────────────────────────────────────────
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
