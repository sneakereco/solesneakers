import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  analyticsFactSchema,
  factFields,
  type AnalyticsFact,
} from "../CommerceFacts/contract";
import {
  REPORT_ENDPOINT_VERSIONS,
  type CompiledQuery,
} from "../Reporting/query-contract";

export const SNAPSHOT_LIMIT = 2000;
export const reconciliationVariables = [
  "dataset_id",
  "start_inclusive",
  "end_exclusive",
].map((code_name) => ({ code_name, type: "String" as const }));
const commonColumns = [
  "dataset_id",
  "environment",
  "fact_id",
  "revision",
  "kind",
  "effective_at",
  "recorded_at",
  "currency",
  "order_id",
  "buyer_key",
  "payload",
] as const;
const envelopeColumns = [
  "publication_id",
  "actor",
  "event_time",
  "storefront",
  "schema_version",
] as const;
const timestamp = (column: string) =>
  `formatDateTime(${column},'%Y-%m-%dT%H:%i:%S.%fZ','UTC')`;
const range = (column: string) =>
  `${column} >= parseDateTime64BestEffort({variables.start_inclusive},6,'UTC') AND ${column} < parseDateTime64BestEffort({variables.end_exclusive},6,'UTC')`;
const bounded = (column: string, limit = 256) =>
  `if(length(${column}) <= ${limit}, ${column}, '')`;
const stringProperty = (key: string) => bounded(`JSONExtractString(properties,'${key}')`);
// Preserve absent vs explicit null on the two nullable contract fields.
const nullableId = (key: string) =>
  `if(JSONExtractRaw(properties,'${key}')='null',NULL,${stringProperty(key)})`;
const rawFields = [
  stringProperty("dataset_id"),
  stringProperty("environment"),
  stringProperty("fact_id"),
  bounded("JSONExtractRaw(properties,'fact_revision')", 16),
  stringProperty("fact_kind"),
  stringProperty("effective_at"),
  stringProperty("recorded_at"),
  stringProperty("currency"),
  nullableId("order_id"),
  nullableId("buyer_key"),
  bounded("JSONExtractRaw(properties,'payload')", 8192),
  "toString(uuid)",
  bounded("distinct_id"),
  timestamp("timestamp"),
  stringProperty("storefront"),
  bounded("JSONExtractRaw(properties,'schema_version')", 16),
];
const rawColumns = [...commonColumns, ...envelopeColumns];
function definition(
  name: "sole_analytics_reconciliation_raw" | "sole_analytics_reconciliation_warehouse",
  projection: string,
) {
  return {
    name,
    version: REPORT_ENDPOINT_VERSIONS[name],
    variables: reconciliationVariables,
    sql: `SELECT *, count() OVER () AS snapshot_rows FROM (SELECT DISTINCT ${projection}) ORDER BY fact_id, revision`,
  };
}
export const reconciliationRawEndpoint = definition(
  "sole_analytics_reconciliation_raw",
  rawFields.map((f, i) => f + " AS " + rawColumns[i]).join(",\n ") +
    ` FROM events WHERE event='sole_analytics_fact_v2' AND properties.dataset_id={variables.dataset_id} AND ${range("timestamp")}`,
);
export const reconciliationWarehouseEndpoint = definition(
  "sole_analytics_reconciliation_warehouse",
  `dataset_id,environment,fact_id,revision,kind,${timestamp("effective_at")} AS effective_at,${timestamp("recorded_at")} AS recorded_at,currency,order_id,buyer_key,payload
 FROM analytics_financial_export WHERE dataset_id={variables.dataset_id} AND ${range("analytics_financial_export.effective_at")}`,
);

export class IncompleteEvidence extends Error {
  constructor(readonly reason: "oversized-window" | "missing-rows" | "invalid-evidence") {
    super(reason);
  }
}
const incomplete = (): never => {
  throw new IncompleteEvidence("invalid-evidence");
};
export const sourcePublication = z.strictObject({
  publicationId: z.uuid(),
  fact: analyticsFactSchema,
});
type Publication = z.infer<typeof sourcePublication>;
type Evidence = {
  fact: AnalyticsFact;
  publicationId?: string;
  actor?: string;
  eventTime?: string;
  environment: string;
};
type Differences = { missing: number; extra: number; conflicting: number };
type Surface = "raw" | "warehouse";

// Date.parse retains milliseconds. Preserve the remaining supported microseconds in comparisons.
function instant(value: string): bigint {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return incomplete();
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? "";
  return BigInt(ms) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
}
export function reconciliationWindow(start: unknown, end: unknown) {
  const startInclusive = factFields.effectiveAt.parse(start),
    endExclusive = factFields.effectiveAt.parse(end);
  if (instant(startInclusive) >= instant(endExclusive))
    throw new RangeError("Invalid reconciliation interval");
  return { startInclusive, endExclusive };
}
function comparable(row: Evidence) {
  const payload: Record<string, unknown> = { ...row.fact.payload };
  for (const key of [
    "resolvedAt",
    "firstPurchaseAt",
    "lastPurchaseAt",
    "paidAt",
    "fulfilledAt",
  ]) {
    if (typeof payload[key] === "string") payload[key] = instant(payload[key] as string);
  }
  return {
    ...row,
    eventTime: row.eventTime ? instant(row.eventTime) : undefined,
    fact: {
      ...row.fact,
      effectiveAt: instant(row.fact.effectiveAt),
      recordedAt: instant(row.fact.recordedAt),
      payload,
    },
  };
}
const revisionKey = (fact: AnalyticsFact) => fact.factId + "#" + fact.revision;
export function expectedEvidence(
  publications: Publication[],
  dataset: string,
  start: string,
  end: string,
) {
  const raw = new Map<string, Evidence>(),
    warehouse = new Map<string, Evidence>(),
    uuids = new Set<string>();
  const environment = dataset === "sole-staging" ? "staging" : "production";
  const lo = instant(start),
    hi = instant(end);
  for (const { publicationId, fact } of publications) {
    const key = revisionKey(fact);
    if (
      fact.datasetId !== dataset ||
      instant(fact.effectiveAt) < lo ||
      instant(fact.effectiveAt) >= hi ||
      raw.has(key) ||
      uuids.has(publicationId)
    )
      return incomplete();
    uuids.add(publicationId);
    const actor =
      "commerce:" +
      (fact.orderId ??
        (fact.kind === "payment_attempt"
          ? fact.payload.attemptId
          : fact.factId.split(":").at(-1)));
    raw.set(key, {
      fact,
      environment,
      publicationId,
      actor,
      eventTime: fact.effectiveAt,
    });
    if ((warehouse.get(fact.factId)?.fact.revision ?? 0) < fact.revision)
      warehouse.set(fact.factId, { fact, environment });
  }
  return { raw, warehouse };
}
const page = z.object({
  columns: z.array(z.string()),
  results: z.array(z.array(z.unknown())).max(SNAPSHOT_LIMIT),
  hasMore: z.boolean(),
  truncated: z.boolean().optional(),
});
// JSONExtractRaw preserves missing, string and fractional revisions as distinct observations.
function integerToken(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value)
    ? Number(value)
    : value;
}
function readPayload(text: string): unknown {
  if (text.length > 8192) return incomplete();
  return JSON.parse(
    text,
    (_key: string, value: unknown, context?: { source?: string }) => {
      if (
        typeof value === "number" &&
        (!Number.isSafeInteger(value) ||
          !context?.source ||
          !/^-?\d+(?:\.0+)?$/.test(context.source))
      )
        return incomplete();
      return value;
    },
  );
}
function decode(values: unknown[], surface: Surface): Evidence {
  const [
    datasetId,
    environment,
    factId,
    revision,
    kind,
    effectiveAt,
    recordedAt,
    currency,
    orderId,
    buyerKey,
    wirePayload,
    publicationId,
    actor,
    eventTime,
    storefront,
    version,
  ] = values;
  if (environment !== "staging" && environment !== "production") return incomplete();
  const payload =
    typeof wirePayload === "string" ? readPayload(wirePayload) : wirePayload;
  const fact = analyticsFactSchema.parse({
    datasetId,
    factId,
    revision: surface === "raw" ? integerToken(revision) : revision,
    kind,
    effectiveAt,
    recordedAt,
    currency,
    orderId,
    buyerKey,
    payload,
  });
  if (surface === "warehouse") return { fact, environment };
  if (
    storefront !== "sole" ||
    integerToken(version) !== 2 ||
    typeof actor !== "string" ||
    actor.length > 256
  )
    return incomplete();
  return {
    fact,
    environment,
    publicationId: z.uuid().parse(publicationId),
    actor,
    eventTime: factFields.effectiveAt.parse(eventTime),
  };
}
export function compareEvidence(
  input: unknown,
  surface: Surface,
  expected: Map<string, Evidence>,
  distinctTotal: number,
) {
  const data = page.parse(input),
    columns = [...(surface === "raw" ? rawColumns : commonColumns), "snapshot_rows"];
  if (!isDeepStrictEqual(columns, data.columns)) return incomplete();
  if (data.hasMore || data.truncated) throw new IncompleteEvidence("oversized-window");
  const seen = new Map<string, ReturnType<typeof comparable>>(),
    conflicts = new Set<string>();
  for (const row of data.results) {
    if (row.length !== columns.length) return incomplete();
    const total = row.at(-1);
    if (typeof total === "number" && total > SNAPSHOT_LIMIT)
      throw new IncompleteEvidence("oversized-window");
    if (total !== data.results.length) throw new IncompleteEvidence("missing-rows");
    const candidate = decode(row, surface),
      key = surface === "raw" ? revisionKey(candidate.fact) : candidate.fact.factId;
    const value = comparable(candidate);
    const first = seen.get(key),
      source = expected.get(key);
    if (
      (first && !isDeepStrictEqual(first, value)) ||
      (source && !isDeepStrictEqual(comparable(source), value))
    )
      conflicts.add(key);
    seen.set(key, value);
  }
  if (seen.size !== distinctTotal) throw new IncompleteEvidence("missing-rows");
  const difference: Differences = { missing: 0, extra: 0, conflicting: conflicts.size };
  for (const key of expected.keys()) if (!seen.has(key)) difference.missing++;
  for (const key of seen.keys()) if (!expected.has(key)) difference.extra++;
  return difference;
}
export function evidenceInvocation(
  endpoint: typeof reconciliationRawEndpoint,
  variables: CompiledQuery["variables"],
): CompiledQuery {
  return {
    endpoint: endpoint.name,
    version: endpoint.version,
    variables,
    limit: SNAPSHOT_LIMIT,
    offset: 0,
  };
}
