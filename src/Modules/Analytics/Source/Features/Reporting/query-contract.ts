import "server-only";

import { z } from "zod";

import { MAX_REPORT_BUCKETS, MAX_REPORT_OFFSET } from "../ReportContract/filters";

export const REPORT_ENDPOINT_VERSIONS = {
  sole_analytics_reconciliation: 1,
  sole_analytics_reconciliation_raw: 1,
  sole_analytics_reconciliation_warehouse: 1,
  sole_analytics_observe_finance: 1,
  sole_analytics_observe_links: 1,
  sole_analytics_observe_native: 1,
  sole_analytics_journey: 1,
  sole_analytics_sales: 1,
  sole_analytics_sales_series: 1,
  sole_analytics_customers: 1,
  sole_analytics_customer_cohorts: 1,
  sole_analytics_sessions: 1,
  sole_analytics_visitor_series: 1,
  sole_analytics_active: 1,
  sole_analytics_inventory_demand: 1,
  sole_analytics_acquisition: 1,
  sole_analytics_acquisition_series: 1,
  sole_analytics_discovery: 1,
  sole_analytics_discovery_series: 1,
  sole_analytics_products: 1,
  sole_analytics_payments: 1,
  sole_analytics_health: 1,
} as const;

type ReportEndpoint = keyof typeof REPORT_ENDPOINT_VERSIONS;

export const MAX_POSTHOG_QUERY_ROWS = MAX_REPORT_BUCKETS;
export const CSV_EXECUTION = Symbol("complete-aggregate-export");
export type CsvExecution = typeof CSV_EXECUTION;
export const CSV_AXIS_LIMIT = 5000;
export class ExportScopeError extends Error {
  constructor() {
    super(
      "The complete aggregate export could not fit or be verified. Narrow the filters or date range.",
    );
  }
}
export const rankedExportAxes: Partial<Record<ReportEndpoint, readonly string[]>> = {
  sole_analytics_products: ["product", "variant", "brand", "category", "size"],
  sole_analytics_acquisition: ["source", "channel", "campaign", "placement"],
  sole_analytics_discovery: ["source", "channel", "campaign", "placement"],
};

const variable = z.union([z.string().max(256), z.number(), z.boolean(), z.null()]);
export type EndpointVariable = z.infer<typeof variable>;

const querySchema = z.strictObject({
  endpoint: z.custom<ReportEndpoint>(
    (value) =>
      typeof value === "string" && Object.hasOwn(REPORT_ENDPOINT_VERSIONS, value),
  ),
  version: z.number().int().positive(),
  variables: z
    .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), variable)
    .refine((values) => Object.keys(values).length <= 64),
  limit: z.number().int().min(1).max(MAX_POSTHOG_QUERY_ROWS),
  offset: z.number().int().min(0).max(MAX_REPORT_OFFSET),
});

export type CompiledQuery = z.infer<typeof querySchema>;

const exportQuerySchema = querySchema.extend({
  limit: z.number().int().min(1).max(30000),
});
export function validateCompiledQuery(
  query: CompiledQuery,
  mode?: CsvExecution,
): CompiledQuery | null {
  const expanded = mode === CSV_EXECUTION && query?.limit > MAX_POSTHOG_QUERY_ROWS;
  const parsed = (expanded ? exportQuerySchema : querySchema).safeParse(query);
  if (
    !parsed.success ||
    REPORT_ENDPOINT_VERSIONS[parsed.data.endpoint] !== parsed.data.version
  ) {
    return null;
  }
  if (
    expanded &&
    (parsed.data.limit !==
      (rankedExportAxes[parsed.data.endpoint]?.length ?? 0) * CSV_AXIS_LIMIT ||
      parsed.data.offset !== 0 ||
      parsed.data.variables.page_start !== "0" ||
      parsed.data.variables.page_end !== String(CSV_AXIS_LIMIT))
  )
    return null;
  return parsed.data;
}

/** Fixed runtime calls keyed by the report section that consumes their aggregate rows. */
export type CompiledReportQueries = {
  queries: Record<string, CompiledQuery>;
};

export type SavedReportEndpoint = {
  name: CompiledQuery["endpoint"];
  version: number;
  variables: Array<{ code_name: string; type: "String" }>;
  sql: string;
};
