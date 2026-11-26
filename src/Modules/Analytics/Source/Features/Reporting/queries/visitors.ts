import "server-only";
import { TZDate } from "@date-fns/tz";
import type { DatasetScope } from "../../CommerceFacts/contract";
import { moneyValue } from "../../ReportContract/money";
import {
  REPORT_FILTER_VALUES,
  REPORT_TIMEZONE,
  type CustomerCohort,
  type ReportRequest,
  type Device,
  type FunnelStep,
} from "../../ReportContract/types";
import {
  compileEndpoint,
  commerceSourceSql,
  endpoint,
  rows,
  count,
  rate,
  decimalText,
  attributionSql,
  attribution,
  inRange,
  instant,
  centsField as amount,
  textField,
} from "./commerce-source";
import {
  sessionSql,
  observationSql,
  devicePredicate,
  segmentPredicate,
} from "./behavior-source";
import { localBucket, decomposed } from "./financial";
import type { CompiledReportQueries } from "../query-contract";

const buyerBase = `${commerceSourceSql}, buyers AS (SELECT DISTINCT confirmed_buyer AS buyer,first_purchase_time FROM selected
 JOIN orders ON order_id=oid WHERE kind='order' AND confirmed_buyer IS NOT NULL)`;
const spendFlow = `CASE WHEN kind='order' THEN ${amount("merchandiseCents")} ELSE -${amount("merchandiseCents")} END`;
const missingFlow = `CASE WHEN kind='order' AND (${decomposed}) THEN 0 WHEN kind='refund' AND ${amount("unallocatedCents")}=0 AND ${amount("merchandiseCents")} IS NOT NULL THEN 0 ELSE 1 END`;
const flowKind = `(kind='order' OR (kind='refund' AND ${textField("status")}='completed'))`;
const customerSql = `${buyerBase}, lifetime AS (
 SELECT f.*,o.order_payload AS order_basis FROM facts f JOIN orders o ON f.order_id=o.oid JOIN buyers b ON o.buyer=b.buyer
 WHERE ${flowKind} AND f.effective_at<=${instant("{variables.as_of}")}
 ), amounts AS (
 SELECT 'lifetime' AS population,${spendFlow} AS value,${missingFlow} AS missing FROM lifetime
 UNION ALL SELECT 'period',${spendFlow},${missingFlow} FROM selected WHERE confirmed_buyer IN(SELECT buyer FROM buyers) AND ${flowKind}
 ) SELECT (SELECT count(*) FROM buyers) AS buyers,
 (SELECT count(*) FROM buyers WHERE ${inRange("first_purchase_time")}) AS new_buyers,
 (SELECT count(*) FROM selected WHERE kind='order' AND confirmed_buyer IS NULL) AS missing_buyers,
 ${["period", "lifetime"].flatMap((p) => ["toString(coalesce(sum(CASE WHEN population='" + p + "' THEN value ELSE 0 END),0)) AS " + p + "_value", "count(CASE WHEN population='" + p + "' AND value IS NOT NULL THEN 1 END) AS " + p + "_known", "count(CASE WHEN population='" + p + "' AND missing=1 THEN 1 END) AS " + p + "_missing"]).join(",")},${attributionSql} FROM amounts`;
const cohortSql = `${buyerBase}, buyer_orders AS (
 SELECT o.*,row_number() OVER (PARTITION BY buyer ORDER BY order_time,oid) AS seq FROM orders o WHERE buyer IS NOT NULL AND order_time<=${instant("{variables.as_of}")}
 ), repeats AS (
 SELECT b.buyer AS cohort_buyer,formatDateTime(b.first_purchase_time,'%Y-%m','America/New_York') AS cohort,
 dateDiff('month',toTimeZone(b.first_purchase_time,'America/New_York'),toTimeZone(o.order_time,'America/New_York')) AS age,o.seq AS seq
 FROM buyers b JOIN buyer_orders o ON b.buyer=o.buyer WHERE ${inRange("b.first_purchase_time")}
 ) SELECT cohort,age,count(DISTINCT CASE WHEN seq=1 THEN cohort_buyer END) AS buyers,count(DISTINCT CASE WHEN seq>1 THEN cohort_buyer END) AS repeaters
 FROM repeats WHERE age>=0 AND age<12 GROUP BY cohort,age ORDER BY cohort,age`;
const stepColumns = [
  "visitors",
  "sessions",
  "viewed",
  "added",
  "checkout",
  "purchasing",
  "ordered",
] as const;
const aggregates = `count(DISTINCT session_visitor) AS visitors,count(*) AS sessions,count(viewed_at) AS viewed,count(added_at) AS added,count(checkout_at) AS checkout,count(purchase_at) AS purchasing,count(CASE WHEN purchase_at>=checkout_at THEN 1 END) AS ordered`;
export function visitorEndpoints(scope: DatasetScope) {
  const session = sessionSql(scope);
  return [
    endpoint(
      "sole_analytics_sessions",
      `${session} SELECT 'total' AS segment,${aggregates},(SELECT count(*) FROM observed WHERE substring(toString(session_id),15,1)!='7' OR occurred_at<entered_at OR occurred_at>=addHours(entered_at,24)) AS invalid_events FROM steps UNION ALL SELECT coalesce(device,'unknown') AS segment,${aggregates},0 AS invalid_events FROM steps GROUP BY segment`,
    ),
    endpoint(
      "sole_analytics_active",
      `WITH ${observationSql({ ...scope, behaviorArchiveCutoff: null })} SELECT count(DISTINCT visitor) AS visitors FROM valid_events WHERE ${devicePredicate} AND ${segmentPredicate("session")}`,
    ),
    endpoint(
      "sole_analytics_visitor_series",
      `${session} SELECT ${localBucket.replaceAll("report_at", "entered_at")} AS period,count(DISTINCT session_visitor) AS visitors,count(*) AS sessions FROM sessions GROUP BY period ORDER BY period`,
    ),
    endpoint("sole_analytics_customers", customerSql),
    endpoint("sole_analytics_customer_cohorts", cohortSql),
  ];
}
export function compileVisitorQueries(
  request: ReportRequest,
  scope: DatasetScope,
  now = new Date(),
): CompiledReportQueries {
  const [steps, active, series, buyers, cohorts] = visitorEndpoints(scope);
  const make = (def: typeof steps, limit: number, comparison = false) =>
    compileEndpoint(def, request, scope, { limit, comparison, now });
  const queries: CompiledReportQueries["queries"] = { sessions: make(steps, 5) };
  if (request.report === "overview") queries.visitorSeries = make(series, 2000);
  if (request.compare && (request.report === "health" || request.report === "overview")) {
    queries.comparisonSessions = make(steps, 5, true);
    if (request.report === "overview")
      queries.comparisonVisitorSeries = make(series, 2000, true);
  }
  if (request.report === "customers") {
    queries.customers = make(buyers, 1);
    queries.cohorts = make(cohorts, 2000);
    queries.active = make(active, 1);
    queries.active.variables.start_inclusive = new Date(
      now.getTime() - 300000,
    ).toISOString();
    queries.active.variables.end_exclusive = now.toISOString();
  }
  return { queries };
}
export function readSessions(raw: unknown, request: ReportRequest) {
  const result = rows(raw, ["segment", ...stepColumns, "invalid_events"], 5);
  const total = result.find((x) => x.segment === "total");
  if (!total) throw new RangeError("Missing session summary.");
  const v = Object.fromEntries(stepColumns.map((k) => [k, count(total[k])]));
  const steps: FunnelStep["step"][] = [
    "session",
    "product-view",
    "cart-addition",
    "checkout",
    "purchase",
  ];
  const counts = [v.sessions, v.viewed, v.added, v.checkout, v.ordered];
  const funnel = steps.map((step, i) => ({
    step,
    sessions: counts[i],
    fromStart: rate(counts[i], counts[0]),
    fromPrevious: rate(counts[i], counts[i ? i - 1 : 0]),
  }));
  const devices = result
    .filter((r) => r !== total)
    .map((r) => {
      if (!REPORT_FILTER_VALUES.device.includes(r.segment as Device))
        throw new RangeError("Invalid device.");
      return {
        device: r.segment as Device,
        visitors: count(r.visitors),
        sessions: count(r.sessions),
      };
    })
    .sort(
      (a, b) =>
        (request.sort === "visitors"
          ? b.visitors - a.visitors
          : b.sessions - a.sessions) || a.device.localeCompare(b.device),
    );
  const start = (request.page - 1) * request.pageSize;
  return {
    visitors: v.visitors,
    sessions: v.sessions,
    conversion: rate(v.purchasing, v.sessions),
    invalidEvents: count(total.invalid_events),
    funnel,
    devices: {
      rows: devices.slice(start, start + request.pageSize),
      totalCount: devices.length,
      page: request.page,
      pageSize: request.pageSize,
    },
  };
}

export function readBuyers(raw: unknown) {
  const [r] = rows(
    raw,
    [
      "buyers",
      "new_buyers",
      "missing_buyers",
      "period_value",
      "period_known",
      "period_missing",
      "lifetime_value",
      "lifetime_known",
      "lifetime_missing",
      "eligible_orders",
      "attributed_orders",
    ],
    1,
  );
  if (!r) throw new RangeError("Missing customer aggregate.");
  const buyers = count(r.buyers),
    newBuyers = count(r.new_buyers);
  if (newBuyers > buyers) throw new RangeError("Invalid buyer counts.");
  function spend(k: string) {
    const missing = count(r[k + "_missing"]),
      known = count(r[k + "_known"]);
    return moneyValue(
      !known && missing ? null : decimalText(r[k + "_value"], true),
      missing,
    );
  }
  return {
    buyers,
    newBuyers,
    returningBuyers: buyers - newBuyers,
    missingBuyerOrders: count(r.missing_buyers),
    selectedPeriodSpend: spend("period"),
    observedLifetimeSpend: spend("lifetime"),
    attribution: attribution(r),
  };
}
export function readCohorts(raw: unknown, now: Date): CustomerCohort[] {
  const grouped = new Map<string, { buyers: number; repeats: Map<number, number> }>();
  for (const r of rows(raw, ["cohort", "age", "buyers", "repeaters"], 2000)) {
    if (typeof r.cohort !== "string" || !/^\d{4}-(0[1-9]|1[012])$/.test(r.cohort))
      throw new RangeError("Invalid cohort month.");
    const group = grouped.get(r.cohort) ?? {
      buyers: 0,
      repeats: new Map<number, number>(),
    };
    const age = count(r.age);
    if (age >= 12 || group.repeats.has(age))
      throw new RangeError("Invalid cohort offset.");
    if (age === 0) group.buyers = count(r.buyers);
    group.repeats.set(age, count(r.repeaters));
    grouped.set(r.cohort, group);
  }
  const eastern = new TZDate(now, REPORT_TIMEZONE),
    asOf = eastern.getFullYear() * 12 + eastern.getMonth();
  return [...grouped].map(([month, g]) => {
    const since = asOf - (Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1);
    return {
      month,
      buyers: g.buyers,
      repeatPurchases: Array.from({ length: 12 }, (_, i) => ({
        monthsSinceFirstPurchase: i,
        repeatPurchaseRate:
          i >= since ? rate(null, null) : rate(g.repeats.get(i) ?? 0, g.buyers),
      })),
    };
  });
}
