import type { Tool } from "./types";
import { addressSchema, dateRangeSchema } from "./types";

export const jobTools: Tool[] = [
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
];
