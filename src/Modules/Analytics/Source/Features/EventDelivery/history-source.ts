import "server-only";
import {
  analyticsInstantMicros as time,
  formatAnalyticsMicros as format,
} from "./instant";
import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { datasetIdSchema } from "../CommerceFacts/contract";
import type { DatasetScope } from "../CommerceFacts/contract";

export const warehouseSources = {
  finance: {
    table: "analytics_financial_export",
    keys: ["dataset_id", "fact_id"],
    cursor: "updated_at",
  },
  purchases: {
    table: "analytics_purchase_link_export",
    keys: ["dataset_id", "order_id"],
    cursor: "updated_at",
  },
  behavior: {
    table: "analytics_behavior_export",
    keys: ["dataset_id", "event_uuid"],
    cursor: "updated_at",
  },
} as const;
// Source names describe the PostgreSQL exports. HogQL reads the connector's
// materialized tables, which have the same Postgres prefix in both projects.
export const postHogWarehouseTables = {
  finance: "postgres_analytics_financial_export",
  purchases: "postgres_analytics_purchase_link_export",
} as const;
export function financialHistorySource(source: DatasetScope["financialSource"]) {
  return source === "warehouse" ? warehouseSources.finance.table : null;
}
export type HistoryInterval = { start: string; end: string };
// Only observed, reconciled intervals qualify. Split both sources at the same event-time cutoff.
export function behaviorHistoryCoverage(
  request: HistoryInterval,
  cutoff: string | null,
  archive: readonly HistoryInterval[],
  native: readonly HistoryInterval[],
): HistoryInterval[] {
  const lo = time(request.start),
    hi = time(request.end);
  if (lo >= hi) throw new RangeError("Invalid history interval");
  const boundary = cutoff === null ? null : time(cutoff);
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  const max = (a: bigint, b: bigint) => (a > b ? a : b);
  const segments = [
    ...(boundary === null
      ? []
      : archive.map((i) => [time(i.start), min(time(i.end), boundary)])),
    ...native.map((i) => [
      boundary === null ? time(i.start) : max(time(i.start), boundary),
      time(i.end),
    ]),
  ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let cursor = lo;
  const gaps: HistoryInterval[] = [];
  for (const [a, b] of segments) {
    const start = max(a, lo),
      end = min(b, hi);
    if (end <= cursor || start >= end) continue;
    if (start > cursor) gaps.push({ start: format(cursor), end: format(start) });
    cursor = end;
  }
  if (cursor < hi) gaps.push({ start: format(cursor), end: format(hi) });
  return gaps;
}
export function warehouseFreshness(
  observation: { sourceFreshThrough: string; observedAt: string } | null,
  asOf: Date,
) {
  if (!observation) return { status: "unknown" as const, sourceFreshThrough: null };
  const through = Date.parse(observation.sourceFreshThrough),
    observed = Date.parse(observation.observedAt);
  if (
    !Number.isFinite(through) ||
    !Number.isFinite(observed) ||
    observed > asOf.getTime() ||
    through > observed
  )
    return { status: "unknown" as const, sourceFreshThrough: null };
  return {
    status:
      asOf.getTime() - through <= 300000 ? ("current" as const) : ("lagging" as const),
    sourceFreshThrough: observation.sourceFreshThrough,
  };
}
const instant = z.iso.datetime({ offset: true });
const intervalSchema = z.strictObject({ start: instant, end: instant });
const evidenceSchema = z.strictObject({
  archive: z.array(intervalSchema),
  native: z.array(intervalSchema),
  observation: z
    .strictObject({ sourceFreshThrough: instant, observedAt: instant })
    .nullable(),
});
export type HistoryEvidence = z.infer<typeof evidenceSchema>;
export async function readHistoryEvidence(
  db: AdminSupabaseClient,
  datasetId: string,
): Promise<HistoryEvidence> {
  const { data, error } = await db.rpc("analytics_read_history_evidence", {
    p_dataset_id: datasetIdSchema.parse(datasetId),
  });
  if (error) throw new Error("Analytics history evidence unavailable");
  return evidenceSchema.parse(data);
}
