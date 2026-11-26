import "server-only";
import type { DatasetScope } from "../../CommerceFacts/contract";
import { moneyValue } from "../../ReportContract/money";
import type {
  ReportRequest,
  SourceRow,
  AttributionBreakdown,
  PaginatedRows,
} from "../../ReportContract/types";
import { dimensions } from "../../VisitorMeasurement/contract";
import { observationSql, devicePredicate, segmentPredicate } from "./behavior-source";
import {
  commerceSourceFor,
  compileEndpoint,
  endpoint,
  textField,
  centsField,
  rows,
  count,
  decimalText,
  attributionSql,
  attribution,
  instant,
} from "./commerce-source";
import { calendarBuckets, decomposed, localBucket } from "./financial";
import type { CompiledReportQueries } from "../query-contract";

const columns = [
  "sessions",
  "purchasing",
  "confirmed",
  "revenue",
  "known",
  "missing",
] as const;
function acquisitionSql(scope: DatasetScope, discovery: boolean) {
  const mode = discovery ? "discovery" : "purchase_session",
    prefix = discovery ? "discovery" : "session",
    merch = centsField("merchandiseCents");
  const source = `${commerceSourceFor(mode)},${observationSql(scope)},
 linked_orders AS (SELECT s.*,l.session_id AS linked_sid,l.${mode} AS dimensions FROM selected s LEFT JOIN ranked_links l ON s.order_id=toString(l.order_id) AND l.active=1 AND l.link_rank=1),
 purchases AS (SELECT toString(linked_sid) AS sid,max(report_at) AS bought_at FROM linked_orders WHERE kind='order' AND has_link=1 AND report_at<${instant("{variables.behavior_end}")} GROUP BY sid),
 flows AS (
 SELECT e.entered_at AS report_at,${dimensions.map((k) => "coalesce(e." + prefix + "_" + k + ",'unknown') AS " + k).join(",")},e.session_visitor AS visitor,
 1 AS sessions,CASE WHEN bought_at>=e.entered_at AND bought_at<addHours(e.entered_at,24) THEN 1 ELSE 0 END AS purchasing,0 AS confirmed,0 AS amount,0 AS known,0 AS missing
 FROM session_entries e LEFT JOIN purchases p ON e.session_id=p.sid WHERE ${devicePredicate} AND ${segmentPredicate(prefix)}
 UNION ALL SELECT report_at,${dimensions.map((k) => "CASE WHEN has_link=1 THEN coalesce(" + textField(k, "dimensions") + ",'unknown') ELSE 'unattributed' END").join(",")},NULL,
 0,0,CASE WHEN kind='order' THEN 1 ELSE 0 END,CASE WHEN kind='order' THEN ${merch} ELSE -${merch} END,CASE WHEN ${merch} IS NULL THEN 0 ELSE 1 END,
 CASE WHEN kind='order' AND ${decomposed} THEN 0 WHEN kind='refund' AND ${centsField("unallocatedCents")}=0 AND ${merch} IS NOT NULL THEN 0 ELSE 1 END
 FROM linked_orders WHERE kind='order' OR (kind='refund' AND ${textField("status")}='completed')
 )`;
  const sums =
    "sum(sessions) AS traffic,sum(purchasing) AS bought,sum(confirmed) AS orders,sum(amount) AS net,sum(known) AS known_amounts,sum(missing) AS missing_amounts";
  const table = `${source}, axes AS (${dimensions.map((k) => "SELECT '" + k + "' AS axis").join(" UNION ALL ")}),
 grouped AS (SELECT axis,CASE axis ${dimensions.map((k) => "WHEN '" + k + "' THEN " + k).join(" ")} END AS label,${sums} FROM flows CROSS JOIN axes GROUP BY axis,label),
 ranked AS (SELECT *,row_number() OVER(PARTITION BY axis ORDER BY CASE {variables.sort} WHEN 'revenue' THEN net WHEN 'confirmedOrders' THEN orders WHEN 'purchasingSessions' THEN bought ELSE traffic END DESC,label) AS rank_num FROM grouped),
 totals AS (SELECT axis,count(*) AS total FROM grouped GROUP BY axis)
 SELECT a.axis AS axis,nullIf(r.label,'') AS label,r.traffic AS sessions,r.bought AS purchasing,r.orders AS confirmed,toString(r.net) AS revenue,r.known_amounts AS known,r.missing_amounts AS missing,
 coalesce(t.total,0) AS total,${attributionSql} FROM axes a LEFT JOIN totals t ON t.axis=a.axis LEFT JOIN ranked r ON r.axis=a.axis AND r.rank_num>toInt({variables.page_start}) AND r.rank_num<=toInt({variables.page_end}) ORDER BY a.axis,r.rank_num`;
  const series = `${source} SELECT ${localBucket} AS period,${sums.replace("sum(amount) AS net", "toString(sum(amount)) AS net")},count(DISTINCT visitor) AS visitors FROM flows GROUP BY period ORDER BY period`;
  return { table, series };
}
export function acquisitionEndpoints(scope: DatasetScope) {
  const purchase = acquisitionSql(scope, false),
    discovery = acquisitionSql(scope, true);
  return [
    endpoint("sole_analytics_acquisition", purchase.table),
    endpoint("sole_analytics_discovery", discovery.table),
    endpoint("sole_analytics_acquisition_series", purchase.series),
    endpoint("sole_analytics_discovery_series", discovery.series),
  ];
}
export function compileAcquisitionQueries(
  request: ReportRequest,
  scope: DatasetScope,
): CompiledReportQueries {
  const [purchase, discovery, ps, ds] = acquisitionEndpoints(scope);
  const queries: CompiledReportQueries["queries"] = {
    purchaseSession: compileEndpoint(purchase, request, scope, {
      limit: 4 * request.pageSize,
    }),
  };
  if (request.report !== "overview") {
    queries.discovery = compileEndpoint(discovery, request, scope, {
      limit: 4 * request.pageSize,
    });
    queries.purchaseSeries = compileEndpoint(ps, request, scope, { limit: 2000 });
    queries.discoverySeries = compileEndpoint(ds, request, scope, { limit: 2000 });
  }
  return { queries };
}
const net = (value: unknown, known: unknown, missing: unknown) =>
  moneyValue(
    count(known) === 0 && count(missing) > 0 ? null : decimalText(value ?? "0", true),
    count(missing),
  );
export function readSources(raw: unknown, request: ReportRequest, behavior: boolean) {
  const records = rows(
    raw,
    ["axis", "label", ...columns, "total", "eligible_orders", "attributed_orders"],
    4 * request.pageSize,
  );
  if (!records.length) throw new RangeError("Missing acquisition coverage.");
  const page = (axis: string): PaginatedRows<SourceRow> => {
    const subset = records.filter((r) => r.axis === axis);
    if (!subset.length) throw new RangeError("Missing acquisition axis.");
    const totalCount = count(subset[0].total);
    const values = subset
      .filter((r) => r.label !== null && r.label !== undefined)
      .map((r) => {
        if (typeof r.label !== "string")
          throw new RangeError("Invalid acquisition label.");
        return {
          key: r.label,
          label: r.label,
          sessions: behavior ? count(r.sessions) : null,
          purchasingSessions: behavior ? count(r.purchasing) : null,
          confirmedOrders: count(r.confirmed),
          revenue: net(r.revenue, r.known, r.missing),
        };
      });
    return { rows: values, totalCount, page: request.page, pageSize: request.pageSize };
  };
  return {
    attribution: attribution(records[0]),
    sources: page("source"),
    channels: page("channel"),
    campaigns: page("campaign"),
    placements: page("placement"),
  };
}
export function readAcquisitionPeriod(
  table: unknown,
  series: unknown,
  request: ReportRequest,
  activatedAt: string,
  through: string | null,
): AttributionBreakdown {
  const entries = rows(
    series,
    [
      "period",
      "traffic",
      "bought",
      "orders",
      "net",
      "known_amounts",
      "missing_amounts",
      "visitors",
    ],
    2000,
  );
  const buckets = new Map(entries.map((r) => [r.period, r]));
  return {
    ...readSources(table, request, through !== null),
    series: calendarBuckets(request, false, (date, startInclusive, endExclusive) => {
      const r = buckets.get(date),
        active = Date.parse(endExclusive) > Date.parse(activatedAt);
      const observed =
        active && through !== null && Date.parse(startInclusive) < Date.parse(through);
      return {
        startInclusive,
        endExclusive,
        confirmedOrders: active ? count(r?.orders ?? 0) : null,
        netMerchandise: active
          ? net(r?.net ?? "0", r?.known_amounts ?? 0, r?.missing_amounts ?? 0)
          : moneyValue(null),
        visitors: observed ? count(r?.visitors ?? 0) : null,
        sessions: observed ? count(r?.traffic ?? 0) : null,
      };
    }),
  };
}
