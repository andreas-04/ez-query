export interface InputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  input_schema: InputSchema;
}

export const addressSchema = {
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

export const dateRangeSchema = {
  type: "object" as const,
  properties: {
    start_date: { type: "string", description: "Inclusive start date in YYYY-MM-DD format" },
    end_date: { type: "string", description: "Inclusive end date in YYYY-MM-DD format" },
  },
  required: ["start_date", "end_date"],
};
