import "server-only";

import { z } from "zod";

import { MAX_REPORT_BUCKETS, MAX_REPORT_OFFSET } from "../ReportContract/filters";

export const REPORT_ENDPOINT_VERSIONS = {
  sole_analytics_reconciliation: 1,
  sole_analytics_reconciliation_raw: 2,
  sole_analytics_reconciliation_warehouse: 2,
  sole_analytics_overview: 1,
  sole_analytics_sales: 1,
  sole_analytics_customers: 1,
  sole_analytics_acquisition: 1,
  sole_analytics_products: 1,
  sole_analytics_payments: 1,
  sole_analytics_health: 1,
} as const;

type ReportEndpoint = keyof typeof REPORT_ENDPOINT_VERSIONS;

export const MAX_POSTHOG_QUERY_ROWS = MAX_REPORT_BUCKETS;

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

export function validateCompiledQuery(query: CompiledQuery): CompiledQuery | null {
  const parsed = querySchema.safeParse(query);
  if (
    !parsed.success ||
    REPORT_ENDPOINT_VERSIONS[parsed.data.endpoint] !== parsed.data.version
  ) {
    return null;
  }
  return parsed.data;
}
