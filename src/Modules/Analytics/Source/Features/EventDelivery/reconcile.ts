import "server-only";
import { z } from "zod";
import { DATASET_IDS } from "../Configuration/dataset";
import type { ResolvedRange } from "../ReportContract/types";
import type { CompiledQuery } from "../Reporting/query-contract";
import { REPORT_ENDPOINT_VERSIONS } from "../Reporting/query-contract";
import { postHogWarehouseTables, warehouseFreshness } from "./history-source";
import {
  compareEvidence,
  evidenceInvocation,
  expectedEvidence,
  IncompleteEvidence,
  reconciliationRawEndpoint,
  reconciliationWarehouseEndpoint,
  reconciliationVariables,
  reconciliationWindow,
  SNAPSHOT_LIMIT,
  sourcePublication,
} from "./reconciliation-evidence";
export {
  reconciliationRawEndpoint,
  reconciliationWarehouseEndpoint,
} from "./reconciliation-evidence";

const name = "sole_analytics_reconciliation";
export const reconciliationEndpoint = {
  name,
  version: REPORT_ENDPOINT_VERSIONS[name],
  variables: reconciliationVariables,
  sql: `SELECT
 (SELECT uniqExact(tuple(properties.fact_id, properties.fact_revision)) FROM events
   WHERE event = 'sole_analytics_fact_v2' AND properties.storefront = 'sole' AND properties.schema_version = 2
   AND properties.dataset_id = {variables.dataset_id}
   AND timestamp >= parseDateTime64BestEffort({variables.start_inclusive},6,'UTC')
   AND timestamp < parseDateTime64BestEffort({variables.end_exclusive},6,'UTC')) AS visible_revisions,
 (SELECT uniqExact(fact_id) FROM ${postHogWarehouseTables.finance} WHERE dataset_id = {variables.dataset_id}
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
const snapshot = sourceCoverageSchema.extend({
  publications: z.array(sourcePublication).max(SNAPSHOT_LIMIT),
});
export async function reconcileAnalyticsFacts(
  range: Pick<ResolvedRange, "startInclusive" | "endExclusive">,
  deps: ReconciliationDependencies,
) {
  if (!Object.values(DATASET_IDS).some((id) => id === deps.datasetId))
    throw new Error("Invalid reconciliation dataset");
  const verifiedRange = reconciliationWindow(range.startInclusive, range.endExclusive);
  const variables = {
    dataset_id: deps.datasetId,
    start_inclusive: verifiedRange.startInclusive,
    end_exclusive: verifiedRange.endExclusive,
  };
  const asOf = deps.now?.() ?? new Date(),
    freshness = warehouseFreshness(deps.observation ?? null, asOf);
  let source: z.infer<typeof sourceCoverageSchema> | null = null,
    visibleRevisions: number | null = null,
    warehouseFacts: number | null = null;
  const summary = () => ({
    source,
    visibleRevisions,
    warehouseFacts,
    queryAsOf: asOf.toISOString(),
    sourceFreshThrough: freshness.sourceFreshThrough,
    freshness: freshness.status,
  });
  try {
    const [local, provider] = await Promise.all([
      deps.source(deps.datasetId, range.startInclusive, range.endExclusive),
      deps.query({
        endpoint: name,
        version: reconciliationEndpoint.version,
        variables,
        limit: 1,
        offset: 0,
      }),
    ]);
    const checked = snapshot.parse(local);
    const { publications, ...counts } = checked;
    source = counts;
    [[visibleRevisions, warehouseFacts]] = response.parse(provider).results;
    if (Math.max(source.revisions, visibleRevisions, warehouseFacts) > SNAPSHOT_LIMIT)
      throw new IncompleteEvidence("oversized-window");
    const expected = expectedEvidence(
      publications,
      deps.datasetId,
      range.startInclusive,
      range.endExclusive,
    );
    if (
      expected.raw.size !== source.revisions ||
      expected.warehouse.size !== source.facts
    )
      throw new IncompleteEvidence("missing-rows");
    const [raw, warehouse] = await Promise.all([
      deps.query(evidenceInvocation(reconciliationRawEndpoint, variables)),
      deps.query(evidenceInvocation(reconciliationWarehouseEndpoint, variables)),
    ]);
    const differences = {
      raw: compareEvidence(raw, "raw", expected.raw, visibleRevisions),
      warehouse: compareEvidence(
        warehouse,
        "warehouse",
        expected.warehouse,
        warehouseFacts,
      ),
    };
    const mismatch = Object.values(differences).some(
      (d) => d.missing + d.extra + d.conflicting > 0,
    );
    return {
      ...summary(),
      status: mismatch ? ("mismatch" as const) : ("matched" as const),
      differences,
    };
  } catch (error) {
    const reason =
      error instanceof IncompleteEvidence
        ? error.reason
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? "invalid-evidence"
          : "source-or-endpoint-unavailable";
    return {
      ...summary(),
      status: "incomplete" as const,
      reason,
      ...(reason === "oversized-window" ? { action: "narrow-interval" as const } : {}),
    };
  }
}
export type ReconciliationResult = Awaited<ReturnType<typeof reconcileAnalyticsFacts>>;
