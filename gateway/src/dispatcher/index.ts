import { dispatchEmployee } from "./employee";
import { dispatchJob } from "./job";
import { dispatchPayroll } from "./payroll";
import { dispatchScheduling } from "./scheduling";

type PlainObject = Record<string, unknown>;

export async function dispatchToolCall(
  name: string,
  input: PlainObject,
  tenantId: string,
): Promise<PlainObject> {
  try {
    switch (name) {
      case "get_employee":
      case "list_employees":
        return await dispatchEmployee(name, input, tenantId);

      case "create_job":
      case "get_job":
      case "list_jobs":
      case "assign_employees_to_job":
      case "update_job_status":
      case "get_job_location":
        return await dispatchJob(name, input, tenantId);

      case "get_payroll":
      case "get_pay_schedule":
      case "list_pay_runs":
      case "get_pay_rates":
      case "set_pay_rates":
      case "calculate_pay_preview":
        return await dispatchPayroll(name, input, tenantId);

      case "create_shift":
      case "get_shift":
      case "list_shifts":
      case "update_shift":
      case "request_time_off":
      case "get_availability":
        return await dispatchScheduling(name, input, tenantId);

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
