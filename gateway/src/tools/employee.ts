import type { Tool } from "./types";

export const employeeTools: Tool[] = [
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
];
