import "server-only";
import { z } from "zod";
import { DATASET_IDS } from "../Configuration/dataset";
import type { ResolvedRange } from "../ReportContract/types";
import type { CompiledQuery } from "../Reporting/query-contract";
import { REPORT_ENDPOINT_VERSIONS } from "../Reporting/query-contract";
import { warehouseFreshness } from "./history-source";

const name = "sole_analytics_reconciliation";
export const reconciliationEndpoint = {
  name,
  version: REPORT_ENDPOINT_VERSIONS[name],
  variables: ["dataset_id", "start_inclusive", "end_exclusive"].map((code_name) => ({
    code_name,
    type: "String" as const,
  })),
  sql: `SELECT
 (SELECT uniqExact(tuple(properties.fact_id, properties.fact_revision)) FROM events
   WHERE event = 'sole_analytics_fact_v2' AND properties.storefront = 'sole' AND properties.schema_version = 2
   AND properties.dataset_id = {variables.dataset_id}
   AND timestamp >= parseDateTime64BestEffort({variables.start_inclusive},6,'UTC')
   AND timestamp < parseDateTime64BestEffort({variables.end_exclusive},6,'UTC')) AS visible_revisions,
 (SELECT uniqExact(fact_id) FROM analytics_financial_export WHERE dataset_id = {variables.dataset_id}
   AND effective_at >= parseDateTime64BestEffort({variables.start_inclusive},6,'UTC')
   AND effective_at < parseDateTime64BestEffort({variables.end_exclusive},6,'UTC')) AS warehouse_facts`,
};
const count = z.number().int().nonnegative();
export const sourceCoverageSchema = z.strictObject({
  revisions: count,
  facts: count,
  pending: count,
  leased: count,
  failed: count,
  oldestOutstandingAt: z.iso.datetime({ offset: true }).nullable(),
});
const response = z.object({
  columns: z.tuple([z.literal("visible_revisions"), z.literal("warehouse_facts")]),
  results: z.tuple([z.tuple([count, count])]),
  hasMore: z.literal(false),
});
type ReconciliationDependencies = {
  datasetId: string;
  source: (dataset: string, start: string, end: string) => Promise<unknown>;
  query: (query: CompiledQuery) => Promise<unknown>;
  observation?: { sourceFreshThrough: string; observedAt: string } | null;
  now?: () => Date;
};
export async function reconcileAnalyticsFacts(
  range: ResolvedRange,
  deps: ReconciliationDependencies,
) {
  if (!Object.values(DATASET_IDS).some((id) => id === deps.datasetId))
    throw new Error("Invalid reconciliation dataset");
  const [local, provider] = await Promise.all([
    deps.source(deps.datasetId, range.startInclusive, range.endExclusive),
    deps.query({
      endpoint: name,
      version: reconciliationEndpoint.version,
      variables: {
        dataset_id: deps.datasetId,
        start_inclusive: range.startInclusive,
        end_exclusive: range.endExclusive,
      },
      limit: 1,
      offset: 0,
    }),
  ]);
  const source = sourceCoverageSchema.parse(local);
  const [[visibleRevisions, warehouseFacts]] = response.parse(provider).results;
  const asOf = deps.now?.() ?? new Date();
  const freshness = warehouseFreshness(deps.observation ?? null, asOf);
  return {
    status:
      source.revisions === visibleRevisions && source.facts === warehouseFacts
        ? ("matched" as const)
        : ("mismatch" as const),
    source,
    visibleRevisions,
    warehouseFacts,
    queryAsOf: asOf.toISOString(),
    sourceFreshThrough: freshness.sourceFreshThrough,
    freshness: freshness.status,
  };
}
export type ReconciliationResult = Awaited<ReturnType<typeof reconcileAnalyticsFacts>>;
