// Enum values taken directly from the proto definitions.
// With proto-loader enums:"Number", responses carry these numeric values and
// inputs must supply them.  The maps below bridge the human-readable string
// that Claude uses in tool calls and the wire numbers.

// ─── Input maps: string → number ────────────────────────────────────────────

export const WORKER_TYPE: Record<string, number> = {
  OFFICE: 1,
  FIELD:  2,
  MIXED:  3,
};

export const JOB_STATUS: Record<string, number> = {
  SCHEDULED:   1,
  IN_PROGRESS: 2,
  COMPLETE:    3,
  CANCELLED:   4,
};

export const SHIFT_STATUS: Record<string, number> = {
  SCHEDULED: 1,
  COMPLETED: 2,
  MISSED:    3,
  CANCELLED: 4,
};

export const PAY_FREQUENCY: Record<string, number> = {
  WEEKLY:   1,
  BIWEEKLY: 2,
  MONTHLY:  3,
};

// ─── Output maps: number → string ───────────────────────────────────────────

export const WORKER_TYPE_NAMES = Object.fromEntries(
  Object.entries(WORKER_TYPE).map(([k, v]) => [v, k])
) as Record<number, string>;

export const JOB_STATUS_NAMES = Object.fromEntries(
  Object.entries(JOB_STATUS).map(([k, v]) => [v, k])
) as Record<number, string>;

export const SHIFT_STATUS_NAMES = Object.fromEntries(
  Object.entries(SHIFT_STATUS).map(([k, v]) => [v, k])
) as Record<number, string>;

export const PAY_FREQUENCY_NAMES = Object.fromEntries(
  Object.entries(PAY_FREQUENCY).map(([k, v]) => [v, k])
) as Record<number, string>;
