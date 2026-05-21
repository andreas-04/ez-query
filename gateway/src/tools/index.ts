export type { Tool, InputSchema } from "./types";
export { employeeTools } from "./employee";
export { jobTools } from "./job";
export { payrollTools } from "./payroll";
export { schedulingTools } from "./scheduling";

import { employeeTools } from "./employee";
import { jobTools } from "./job";
import { payrollTools } from "./payroll";
import { schedulingTools } from "./scheduling";

export const tools = [
  ...employeeTools,
  ...jobTools,
  ...payrollTools,
  ...schedulingTools,
];
