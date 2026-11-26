import "server-only";
import { z } from "zod";
import { datasetScopeSchema, type DatasetScope } from "../../CommerceFacts/contract";
import { DATASET_IDS } from "../../Configuration/dataset";
import {
  financialHistorySource,
  warehouseSources,
} from "../../EventDelivery/history-source";
import type { ReportRequest, Rate } from "../../ReportContract/types";
import {
  REPORT_ENDPOINT_VERSIONS,
  validateCompiledQuery,
  type CompiledQuery,
  type SavedReportEndpoint,
} from "../query-contract";

export const textField = (key: string, column = "payload") =>
  `nullIf(JSONExtractString(${column},'${key}'),'')`;
export const centsField = (key: string, column = "payload") =>
  `toDecimal128(toInt64OrNull(JSONExtractRaw(${column},'${key}')),0)`;
export const instant = (value: string) =>
  `parseDateTime64BestEffortOrNull(${value},6,'UTC')`;
const variable = (key: string) => `{variables.${key}}`;
const filter = (key: string, column: string) =>
  `(${variable(key)} = '' OR ${column} = ${variable(key)})`;
const productFilters = [
  "productId",
  "variantId",
  "brandId",
  "categoryId",
  "sizeId",
] as const;
const orderFilters = [
  "fulfillment",
  "customer",
  "status",
  ...productFilters,
  "device",
  "source",
  "channel",
  "campaign",
] as const;
const firstPurchase = "min(effective_at) OVER (PARTITION BY buyer_key)";
const start = instant(variable("start_inclusive"));
export const inRange = (col: string) =>
  `${col} >= ${start} AND ${col} < ${instant(variable("end_exclusive"))}`;

// Warehouse connector copies can overlap. Resolve the latest record and the latest
// link (including tombstones) before reading payload fields or filtering business time.
export function commerceSourceFor(attributionColumn: "discovery" | "purchase_session") {
  return `WITH ranked_facts AS (
 SELECT *,row_number() OVER (PARTITION BY dataset_id,fact_id ORDER BY revision DESC,updated_at DESC) AS fact_rank
 FROM ${warehouseSources.finance.table}
 WHERE dataset_id={variables.dataset_id} AND environment={variables.environment}
), facts AS (
 SELECT * FROM ranked_facts WHERE fact_rank=1 AND currency='USD' AND effective_at >= ${instant(variable("activated_at"))}
), ranked_links AS (
 SELECT *,row_number() OVER (PARTITION BY dataset_id,order_id ORDER BY updated_at DESC,active ASC) AS link_rank
 FROM ${warehouseSources.purchases.table} WHERE dataset_id={variables.dataset_id}
), orders AS (
 SELECT order_id AS oid, buyer_key AS buyer, effective_at AS order_time, payload AS order_payload,
 ${firstPurchase} AS first_purchase_time FROM facts WHERE kind='order'
), matching_lines AS (
 SELECT DISTINCT order_id AS matching_order FROM facts WHERE kind='line' AND ${productFilters.map((k) => filter(k.toLowerCase(), textField(k))).join(" AND ")}
), order_dimensions AS (
 SELECT o.*, l.active AS attributed,
 CASE WHEN ${filter("device", "l.device")} AND ${["source", "channel", "campaign"].map((k) => filter(k, textField(k, "l." + attributionColumn))).join(" AND ")}
 AND (${["device", "source", "channel", "campaign"].map((k) => variable(k) + "=''").join(" AND ")} OR l.active=1)
 THEN 1 ELSE 0 END AS matches_segment
 FROM orders o LEFT JOIN ranked_links l ON o.oid=toString(l.order_id) AND l.link_rank=1 AND l.active=1
 LEFT JOIN matching_lines ml ON ml.matching_order=o.oid
 WHERE ${filter("fulfillment", textField("fulfillment", "o.order_payload"))}
 AND ${filter("status", textField("status", "o.order_payload"))}
 AND ({variables.customer}='' OR (o.buyer IS NOT NULL AND (({variables.customer}='new' AND ${inRange("o.first_purchase_time")}) OR ({variables.customer}='returning' AND o.first_purchase_time < ${start}))))
 AND ((${productFilters.map((k) => variable(k.toLowerCase()) + "=''").join(" AND ")}) OR nullIf(ml.matching_order,'') IS NOT NULL)
), enriched AS (
 SELECT f.*,o.oid AS confirmed_id,o.buyer AS confirmed_buyer,o.order_time AS confirmed_at,o.order_payload AS order_basis,
 o.attributed AS has_link,o.matches_segment AS segment_match,
 CASE WHEN f.kind='payment_attempt' THEN coalesce(${textField("method", "f.payload")},'unknown') WHEN ${centsField("totalCollectedCents", "o.order_payload")}>0 THEN coalesce(${textField("paymentMethod", "o.order_payload")},'unknown') ELSE NULL END AS instrument,
 CASE WHEN {variables.date_basis}='order-cohort' OR f.kind IN ('line','fulfillment') THEN o.order_time
 WHEN f.kind='payment_attempt' AND ${textField("outcome", "f.payload")} NOT IN ('unknown','pending') THEN ${instant(textField("resolvedAt", "f.payload"))}
 ELSE f.effective_at END AS report_at
 FROM facts f LEFT JOIN order_dimensions o ON f.order_id=o.oid
 WHERE (nullIf(o.oid,'') IS NOT NULL OR (f.kind='payment_attempt' AND {variables.date_basis}='activity' AND ${orderFilters.map((k) => variable(k.toLowerCase()) + "=''").join(" AND ")}))
), eligible AS (
 SELECT * FROM enriched WHERE ${inRange("report_at")} AND ${filter("payment_method", "instrument")}
), selected AS (
 SELECT * FROM eligible WHERE segment_match=1 OR (kind='payment_attempt' AND nullIf(confirmed_id,'') IS NULL)
)`;
}
export const commerceSourceSql = commerceSourceFor("purchase_session");

export function endpoint(
  name: CompiledQuery["endpoint"],
  sql: string,
): SavedReportEndpoint {
  return {
    name,
    version: REPORT_ENDPOINT_VERSIONS[name],
    sql,
    variables: [
      ...new Set(Array.from(sql.matchAll(/\{variables\.(\w+)\}/g), (m) => m[1])),
    ].map((code_name) => ({ code_name, type: "String" })),
  };
}

export function compileEndpoint(
  def: SavedReportEndpoint,
  request: ReportRequest,
  scope: DatasetScope,
  options: { comparison?: boolean; grouping?: string; limit: number; now?: Date },
): CompiledQuery {
  if (
    !datasetScopeSchema.safeParse(scope).success ||
    DATASET_IDS[scope.environment] !== scope.datasetId ||
    !financialHistorySource(scope.financialSource)
  )
    throw new RangeError("Trusted warehouse reporting is unavailable.");
  const values: Record<string, string> = {
    dataset_id: scope.datasetId,
    inventory_enabled: "yes",
    behavior_enabled: "yes",
    behavior_end: options.comparison
      ? request.range.comparisonEndExclusive
      : request.range.endExclusive,
    as_of: (options.now ?? new Date()).toISOString(),
    page_start: String((request.page - 1) * request.pageSize),
    page_end: String(request.page * request.pageSize),
    sort: request.sort,
    environment: scope.environment,
    activated_at: scope.activatedAt,
    start_inclusive: options.comparison
      ? request.range.comparisonStartInclusive
      : request.range.startInclusive,
    end_exclusive: options.comparison
      ? request.range.comparisonEndExclusive
      : request.range.endExclusive,
    date_basis: request.dateBasis,
    grouping: options.grouping ?? "summary",
    bucket: request.bucket,
    payment_method: request.paymentMethod ?? "",
  };
  for (const key of orderFilters) values[key.toLowerCase()] = request[key] ?? "";
  const query = {
    endpoint: def.name,
    version: def.version,
    variables: Object.fromEntries(
      def.variables.map((v) => [v.code_name, values[v.code_name]]),
    ),
    limit: options.limit,
    offset: 0,
  };
  if (!validateCompiledQuery(query))
    throw new RangeError("Invalid compiled commerce report.");
  return query;
}

const providerRows = z.object({
  columns: z.array(z.string()),
  results: z.array(z.array(z.unknown())),
  hasMore: z.literal(false),
});
export function rows(
  raw: unknown,
  expected: readonly string[],
  max: number,
): Record<string, unknown>[] {
  const { columns, results } = providerRows.parse(raw);
  if (
    results.length > max ||
    columns.length !== expected.length ||
    new Set(columns).size !== expected.length ||
    expected.some((k) => !columns.includes(k)) ||
    results.some((row) => row.length !== columns.length)
  )
    throw new RangeError("Invalid or truncated report columns.");
  return results.map((row) => Object.fromEntries(columns.map((k, i) => [k, row[i]])));
}
export function integer(raw: unknown): number {
  if (
    typeof raw !== "number" &&
    (typeof raw !== "string" || !/^-?(0|[1-9]\d*)$/.test(raw))
  )
    throw new RangeError("Expected integer aggregate.");
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new RangeError("Unsafe integer aggregate.");
  return n;
}
/** SQL explicitly returns canonical decimal text for exact money projections.
 * A JSON number may have already rounded before this boundary can inspect it. */
export function decimalText(raw: unknown, signed = false): number {
  if (typeof raw !== "string") throw new RangeError("Expected a decimal-text aggregate.");
  const n = signed ? integer(raw) : count(raw);
  if (String(n) !== raw) throw new RangeError("Invalid decimal-text aggregate.");
  return n;
}
export function count(raw: unknown): number {
  const n = integer(raw);
  if (n < 0) throw new RangeError("Negative count.");
  return n;
}
export function rate(numerator: number | null, denominator: number | null): Rate {
  if (numerator !== null && denominator !== null && numerator > denominator)
    throw new RangeError("Invalid rate denominator.");
  return {
    numerator,
    denominator,
    value: numerator !== null && denominator ? numerator / denominator : null,
  };
}
export const reportInput = z.object({
  activatedAt: z.iso.datetime({ offset: true }),
  request: z.custom<ReportRequest>((r) => !!r && typeof r === "object" && "range" in r),
  summary: z.unknown(),
  comparison: z.unknown().optional(),
  series: z.unknown().optional(),
  comparisonSeries: z.unknown().optional(),
});
export const attributionSql = `(SELECT count(*) FROM eligible WHERE kind='order') AS eligible_orders,
 (SELECT count(*) FROM eligible WHERE kind='order' AND has_link=1) AS attributed_orders`;
export function attribution(row: Record<string, unknown>) {
  const eligibleOrders = count(row.eligible_orders),
    attributedOrders = count(row.attributed_orders);
  if (attributedOrders > eligibleOrders)
    throw new RangeError("Invalid attribution denominator.");
  return { eligibleOrders, attributedOrders };
}
export function hasComparison(input: z.infer<typeof reportInput>) {
  return (
    input.request.compare &&
    Date.parse(input.activatedAt) < Date.parse(input.request.range.comparisonEndExclusive)
  );
}
