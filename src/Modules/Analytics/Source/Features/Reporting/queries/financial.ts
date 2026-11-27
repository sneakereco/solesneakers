import "server-only";
import { TZDate } from "@date-fns/tz";

import type { DatasetScope } from "../../CommerceFacts/contract";
import { moneyValue } from "../../ReportContract/money";
import {
  REPORT_FILTER_VALUES,
  REPORT_TIMEZONE,
  type SalesData,
  type ReportRequest,
  type TimeBucket,
  type PaymentsData,
  type SalesPeriod,
  type PaymentsPeriod,
  type PaymentRow,
} from "../../ReportContract/types";
import type { CompiledReportQueries } from "../query-contract";
import {
  attributionSql,
  attribution,
  commerceSourceSql,
  compileEndpoint,
  endpoint,
  centsField as amount,
  textField as str,
  integer,
  decimalText,
  count,
  rate,
  rows,
  reportInput,
  hasComparison,
} from "./commerce-source";

const order = "kind='order'",
  line = "kind='line'",
  refund = "kind='refund'",
  detail = "kind='refund_line'";
const paid = `${order} AND ${amount("totalCollectedCents")}>0`;
const goodRefund = `${refund} AND ${str("status")}='completed'`;
const signed = `CASE WHEN ${str("adjustment")}='credit' THEN -${amount("amountCents")} ELSE ${amount("amountCents")} END`;
const sum = (condition: string, value = "1") =>
  `coalesce(sum(CASE WHEN ${condition} THEN ${value} ELSE 0 END),0)`;
const dayLabel = (d: string) => `formatDateTime(${d},'%Y-%m-%d','America/New_York')`;
export const localBucket = `CASE WHEN {variables.bucket}='week' THEN ${dayLabel("toStartOfWeek(report_at,1,'America/New_York')")} WHEN {variables.bucket}='month' THEN ${dayLabel("toStartOfMonth(toTimeZone(report_at,'America/New_York'))")} ELSE ${dayLabel("report_at")} END`;
const saleValue = amount("merchandiseCents", "order_basis");
export const decomposed = `(${saleValue}=${amount("grossMerchandiseCents", "order_basis")}-${amount("discountCents", "order_basis")} AND ${amount("totalCollectedCents", "order_basis")}=${saleValue}+${amount("shippingCents", "order_basis")}+${amount("taxCents", "order_basis")})`;
const originalLinesReconcile = `e.line_count>0 AND e.unknown_line_amounts=0 AND e.line_revenue=${saleValue}`;
export const evidenceSql = `, order_evidence AS (
 SELECT order_id AS evidence_order, ${sum(line)} AS line_count,
 ${sum(line, amount("merchandiseCents"))} AS line_revenue,
 ${sum(line + " AND " + amount("merchandiseCents") + " IS NULL")} AS unknown_line_amounts,
 ${sum(line + " AND " + amount("unitCostCents") + " IS NULL")} AS unknown_costs,
 ${sum("kind='fee' AND " + str("adjustment") + "='charge'")} AS fee_charges,
 ${sum("kind='shipping_cost' AND " + str("adjustment") + "='charge'")} AS shipping_charges
 FROM facts GROUP BY order_id
), original_lines AS (
 SELECT order_id AS original_order,${str("lineId")} AS original_line,${amount("unitCostCents")} AS original_cost FROM facts WHERE kind='line'
), refund_lines AS (
 SELECT order_id AS detail_order,${str("refundId")} AS detail_refund,count(*) AS detail_count,
 ${sum("1=1", amount("merchandiseCents"))} AS assigned_merchandise FROM facts WHERE kind='refund_line' GROUP BY order_id,detail_refund
), completed_refunds AS (
 SELECT order_id AS refund_order,${str("refundId")} AS completed_refund FROM facts WHERE ${goodRefund}
), basis AS (
 SELECT s.*, e.line_count,e.unknown_costs,e.fee_charges,e.shipping_charges,
 CASE WHEN ${decomposed} THEN 0 ELSE 1 END AS bad_order,
 CASE WHEN ${originalLinesReconcile} THEN 0 ELSE 1 END AS incomplete_original_lines,
 CASE WHEN ${decomposed} AND ${originalLinesReconcile} THEN 0 ELSE 1 END AS bad_lines,
 l.original_cost AS return_cost,rl.detail_count,rl.assigned_merchandise
 FROM selected s LEFT JOIN order_evidence e ON s.order_id=e.evidence_order
 LEFT JOIN original_lines l ON s.kind='refund_line' AND s.order_id=l.original_order AND ${str("lineId", "s.payload")}=l.original_line
 LEFT JOIN refund_lines rl ON s.kind='refund' AND s.order_id=rl.detail_order AND ${str("refundId", "s.payload")}=rl.detail_refund
 LEFT JOIN completed_refunds cr ON s.kind='refund_line' AND s.order_id=cr.refund_order AND ${str("refundId", "s.payload")}=cr.completed_refund
 WHERE (s.kind!='refund' OR ${str("status", "s.payload")}='completed') AND (s.kind!='refund_line' OR nullIf(cr.completed_refund,'') IS NOT NULL)
)`;
export const unknownReturn = `${refund} AND (${amount("unallocatedCents")}>0 OR (${amount("merchandiseCents")}>0 AND (coalesce(detail_count,0)=0 OR assigned_merchandise!=${amount("merchandiseCents")})))`;
const cost = amount("unitCostCents");
const quantity = amount("quantity"),
  restock = amount("restockedQuantity"),
  merch = amount("merchandiseCents");
const valueBins = [0, 5000, 10000, 25000, 50000, 100000] as const;
const componentFields = {
  gross: "grossMerchandiseCents",
  discount: "discountCents",
  merchandise: "merchandiseCents",
  shipping: "shippingCents",
  tax: "taxCents",
  refund_merch: "merchandiseCents",
  refund_shipping: "shippingCents",
  refund_tax: "taxCents",
} as const;
const metrics: Record<string, string> = {};
for (const [name, key] of Object.entries(componentFields)) {
  const isRefund = name.startsWith("refund_");
  const applies = isRefund ? refund : order;
  metrics[name] = sum(applies, amount(key));
  metrics[name + "_known"] = sum(`${applies} AND ${amount(key)} IS NOT NULL`);
  metrics[name + "_missing"] = sum(
    `${applies} AND (${amount(key)} IS NULL OR ${isRefund ? amount("unallocatedCents") + ">0" : "bad_order=1"})`,
  );
}
Object.assign(metrics, {
  captured: sum(order, amount("totalCollectedCents")),
  refunded: sum(refund, amount("totalCents")),
  unallocated: sum(refund, amount("unallocatedCents")),
  orders: sum(order),
  buyers: `count(DISTINCT CASE WHEN ${order} THEN confirmed_buyer END)`,
  missing_buyers: sum(order + " AND confirmed_buyer IS NULL"),
  order_value: sum(order + " AND bad_order=0", merch),
  missing_values: sum(order + " AND bad_order=1"),
  middle_sum: sum(
    "valid_value=1 AND 2*value_rank BETWEEN value_count AND value_count+2",
    merch,
  ),
  middle_count: sum(
    "valid_value=1 AND 2*value_rank BETWEEN value_count AND value_count+2",
  ),
  units: sum(line, quantity),
  missing_lines: sum(order + " AND bad_lines=1"),
  returned: sum(detail, quantity),
  missing_returns: sum(`(${unknownReturn}) OR (${detail} AND ${quantity} IS NULL)`),
  line_cost: sum(line, `${cost}*${quantity}`),
  returned_cost: sum(detail, `return_cost*${restock}`),
  known_costs: sum(
    `(${line} AND ${cost} IS NOT NULL) OR (${detail} AND (${restock}=0 OR (return_cost IS NOT NULL AND ${restock} IS NOT NULL)))`,
  ),
  missing_costs: sum(
    `(${line} AND ${cost} IS NULL) OR (${detail} AND (${restock} IS NULL OR (${restock}>0 AND return_cost IS NULL))) OR (${order} AND incomplete_original_lines=1) OR (${unknownReturn})`,
  ),
  costed_revenue: sum(`${line} AND ${cost} IS NOT NULL AND bad_lines=0`, merch),
  profit_line_cost: sum(
    `${line} AND ${cost} IS NOT NULL AND bad_lines=0`,
    `${cost}*${quantity}`,
  ),
  profit_refund: sum(`${detail} AND return_cost IS NOT NULL AND bad_lines=0`, merch),
  profit_return_cost: sum(
    `${detail} AND return_cost IS NOT NULL AND bad_lines=0`,
    `return_cost*${restock}`,
  ),
  known_profit: sum(
    `(${line} AND ${cost} IS NOT NULL AND bad_lines=0) OR (${detail} AND return_cost IS NOT NULL AND bad_lines=0 AND ${merch} IS NOT NULL)`,
  ),
  missing_profit: sum(
    `(${detail} AND (${merch} IS NULL OR return_cost IS NULL OR bad_lines=1)) OR (${refund} AND ${amount("unallocatedCents")}>0) OR (${order} AND bad_lines=1)`,
  ),
  covered_orders: sum(order + " AND bad_lines=0 AND unknown_costs=0"),
  lines: sum(line),
  covered_lines: sum(`${line} AND ${cost} IS NOT NULL AND bad_lines=0`),
  fees: sum("kind='fee'", signed),
  known_fees: sum("kind='fee'"),
  missing_fees: sum(`${paid} AND coalesce(fee_charges,0)=0`),
  label_cost: sum("kind='shipping_cost'", signed),
  missing_labels: sum(
    `${order} AND coalesce(${str("fulfillment")},'unknown')!='pickup' AND coalesce(shipping_charges,0)=0`,
  ),
});
for (const [i, min] of valueBins.entries())
  metrics["bin_" + i] = sum(
    `valid_value=1 AND ${merch} >= ${min}` +
      (valueBins[i + 1] === undefined ? "" : ` AND ${merch} < ${valueBins[i + 1]}`),
  );
const summaryProjection = Object.entries(metrics)
  .map(([key, expr]) => `toString(${expr}) AS ${key}`)
  .join(",\n");
const salesSql = `${commerceSourceSql}${evidenceSql}, valued AS (
 SELECT *, CASE WHEN ${order} AND bad_order=0 THEN 1 ELSE 0 END AS valid_value FROM basis
 ), ranked AS (
 SELECT *,row_number() OVER (PARTITION BY valid_value ORDER BY ${merch},fact_id) AS value_rank,
 count(*) OVER (PARTITION BY valid_value) AS value_count FROM valued
 ) SELECT 'summary' AS period,${summaryProjection},${attributionSql} FROM ranked`;
// The time series travels separately so 2,000 buckets never carry the waterfall,
// histogram or cost/median working columns. Both projections use the same measures.
const seriesFields = [
  "orders",
  "merchandise",
  "merchandise_known",
  "merchandise_missing",
  "refund_merch",
  "refund_merch_known",
  "refund_merch_missing",
];
const seriesSql = `${commerceSourceSql}, sales_flows AS (
 SELECT *,CASE WHEN ${decomposed} THEN 0 ELSE 1 END AS bad_order FROM selected WHERE ${order} OR (${goodRefund})
 ) SELECT ${localBucket} AS period,${seriesFields.map((k) => `toString(${metrics[k]}) AS ${k}`).join(",")}
 FROM sales_flows GROUP BY period ORDER BY period`;

const paymentSql = `${commerceSourceSql}${evidenceSql}, method_counts AS (
 SELECT instrument AS method,
 toString(${sum(paid)}) AS paid_orders,toString(${sum(paid, merch)}) AS original_value,
 toString(${sum(paid + " AND bad_order=1")}) AS bad_paid,
 toString(${sum(order, merch)}-${sum(refund, merch)}) AS revenue,
 toString(${sum(`(${order} AND bad_order=1) OR (${refund} AND (${merch} IS NULL OR ${amount("unallocatedCents")}>0))`)}) AS missing_revenue,
 toString(${sum(`(${order} OR ${refund}) AND ${merch} IS NOT NULL`)}) AS known_revenue,
 toString(${sum("kind='fee'", signed)}) AS fees,toString(${sum("kind='fee'")}) AS known_fees,toString(${sum(paid + " AND coalesce(fee_charges,0)=0")}) AS missing_fees,
 ${sum(`kind='payment_attempt' AND ${str("outcome")}='succeeded'`)} AS succeeded,
 ${sum(`kind='payment_attempt' AND ${str("outcome")} IN ('failed','canceled','expired')`)} AS failed,
 ${sum(`kind='payment_attempt' AND ${str("outcome")} IN ('pending','unknown')`)} AS pending
 FROM basis WHERE (${paid}) OR kind IN ('fee','refund') OR (kind='payment_attempt' AND ${str("stage")}='payment')
 GROUP BY instrument
 UNION ALL SELECT 'coverage','0','0','0','0','0','0','0','0','0',0,0,0
 ) SELECT *,${attributionSql} FROM method_counts ORDER BY method`;
export const financialEndpoints = [
  endpoint("sole_analytics_sales", salesSql),
  endpoint("sole_analytics_sales_series", seriesSql),
  endpoint("sole_analytics_payments", paymentSql),
];
export function compileFinancialQueries(
  request: ReportRequest,
  scope: DatasetScope,
): CompiledReportQueries {
  const [summary, series, payments] = financialEndpoints;
  if (request.report === "payments")
    return {
      queries: {
        summary: compileEndpoint(payments, request, scope, { limit: 7 }),
        ...(request.compare
          ? {
              comparison: compileEndpoint(payments, request, scope, {
                comparison: true,
                limit: 7,
              }),
            }
          : {}),
      },
    };
  if (request.report !== "sales") throw new RangeError("Unknown financial report.");
  return {
    queries: {
      summary: compileEndpoint(summary, request, scope, { limit: 1 }),
      series: compileEndpoint(series, request, scope, { limit: 2000 }),
      ...(request.compare
        ? {
            comparison: compileEndpoint(summary, request, scope, {
              comparison: true,
              limit: 1,
            }),
            comparisonSeries: compileEndpoint(series, request, scope, {
              limit: 2000,
              comparison: true,
            }),
          }
        : {}),
    },
  };
}
const salesColumns = [
  "period",
  ...Object.keys(metrics),
  "eligible_orders",
  "attributed_orders",
];
function readSales(raw: Record<string, unknown>) {
  if (typeof raw.period !== "string") throw new RangeError("Invalid report period.");
  const values: Record<string, number> = {};
  for (const key of salesColumns.slice(1)) {
    // Provider decimals are projected as strings. Component inputs, quantities and
    // counts cannot be negative. Signed adjustments may include fee or label credits.
    values[key] =
      key === "eligible_orders" || key === "attributed_orders"
        ? count(raw[key])
        : decimalText(raw[key], key === "fees" || key === "label_cost");
  }
  return { period: raw.period, v: values };
}
const exact = (a: number, b: number, subtract = false) =>
  integer((BigInt(a) + (subtract ? -BigInt(b) : BigInt(b))).toString());
const divide = (numerator: number, n: number) =>
  n
    ? integer(((2n * BigInt(numerator) + BigInt(n)) / (2n * BigInt(n))).toString())
    : null;
const knownMoney = (value: number, known: number, missing: number) =>
  moneyValue(missing && !known ? null : value, missing);
type Totals = Record<string, number>;
function component(v: Totals, key: keyof typeof componentFields) {
  return knownMoney(v[key], v[key + "_known"], v[key + "_missing"]);
}
function net(
  v: Totals,
  key: "merchandise" | "shipping" | "tax",
  deduction: "refund_merch" | "refund_shipping" | "refund_tax",
) {
  return knownMoney(
    exact(v[key], v[deduction], true),
    exact(v[key + "_known"], v[deduction + "_known"]),
    exact(v[key + "_missing"], v[deduction + "_missing"]),
  );
}
export function readSalesBuckets(
  raw: unknown,
  request: ReportRequest,
  comparison: boolean,
  activatedAt: string,
): TimeBucket[] {
  const entries = rows(raw, ["period", ...seriesFields], 2000).map((row) => {
    if (typeof row.period !== "string") throw new RangeError("Invalid sales bucket.");
    return {
      period: row.period,
      v: Object.fromEntries(seriesFields.map((k) => [k, decimalText(row[k])])),
    };
  });
  const byDate = new Map(entries.map((x) => [x.period, x.v]));
  if (byDate.size !== entries.length) throw new RangeError("Duplicate sales bucket.");
  const result = calendarBuckets(
    request,
    comparison,
    (date, startInclusive, endExclusive) => {
      const v = byDate.get(date);
      byDate.delete(date);
      const beforeActivation = Date.parse(endExclusive) <= Date.parse(activatedAt);
      return {
        startInclusive,
        endExclusive,
        confirmedOrders: beforeActivation ? null : (v?.orders ?? 0),
        netMerchandise: beforeActivation
          ? moneyValue(null)
          : v
            ? net(v, "merchandise", "refund_merch")
            : moneyValue(0),
        sessions: null,
        visitors: null,
      };
    },
  );
  if (byDate.size) throw new RangeError("Unexpected provider bucket.");
  return result;
}
export function calendarBuckets<T>(
  request: ReportRequest,
  comparison: boolean,
  map: (period: string, start: string, end: string) => T,
): T[] {
  const r = request.range;
  let cursor = new TZDate(
    comparison ? r.comparisonStartInclusive : r.startInclusive,
    REPORT_TIMEZONE,
  );
  const end = Date.parse(comparison ? r.comparisonEndExclusive : r.endExclusive);
  const result: T[] = [];
  while (cursor.getTime() < end) {
    const anchor = new TZDate(cursor.getTime(), REPORT_TIMEZONE);
    if (request.bucket === "month") anchor.setDate(1);
    if (request.bucket === "week")
      anchor.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
    const date = [
      anchor.getFullYear().toString().padStart(4, "0"),
      String(anchor.getMonth() + 1).padStart(2, "0"),
      String(anchor.getDate()).padStart(2, "0"),
    ].join("-");
    const next = new TZDate(anchor.getTime(), REPORT_TIMEZONE);
    if (request.bucket === "month") next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + (request.bucket === "week" ? 7 : 1));
    const stop = Math.min(end, next.getTime());
    if (stop <= cursor.getTime() || result.length >= 2000)
      throw new RangeError("Invalid bucket boundaries.");
    result.push(
      map(date, new Date(cursor.getTime()).toISOString(), new Date(stop).toISOString()),
    );
    cursor = new TZDate(stop, REPORT_TIMEZONE);
  }
  return result;
}
export function readSalesPeriod(raw: unknown): SalesPeriod {
  const summaries = rows(raw, salesColumns, 1);
  if (summaries.length !== 1) throw new RangeError("Missing sales summary.");
  const { period, v } = readSales(summaries[0]);
  const knownOrders = v.orders - v.missing_values;
  const binnedOrders = valueBins.reduce<number>(
    (total, _, i) => exact(total, v["bin_" + i]),
    0,
  );
  const expectedMiddleCount = knownOrders === 0 ? 0 : knownOrders % 2 === 0 ? 2 : 1;
  if (
    period !== "summary" ||
    v.missing_values > v.orders ||
    v.attributed_orders > v.eligible_orders ||
    v.missing_buyers > v.orders ||
    v.buyers > v.orders - v.missing_buyers ||
    binnedOrders !== knownOrders ||
    v.middle_count !== expectedMiddleCount
  )
    throw new RangeError("Invalid sales denominators.");
  const netShipping = net(v, "shipping", "refund_shipping");
  const cogs = exact(v.line_cost, v.returned_cost, true);
  const profit = exact(
    exact(v.costed_revenue, v.profit_refund, true),
    exact(v.profit_line_cost, v.profit_return_cost, true),
    true,
  );
  return {
    grossMerchandise: component(v, "gross"),
    discounts: component(v, "discount"),
    merchandiseRefunds: component(v, "refund_merch"),
    shippingCollected: component(v, "shipping"),
    shippingRefunds: component(v, "refund_shipping"),
    taxCollected: component(v, "tax"),
    taxRefunds: component(v, "refund_tax"),
    unallocatedRefunds: moneyValue(v.unallocated),
    netMerchandise: net(v, "merchandise", "refund_merch"),
    netShipping,
    netTax: net(v, "tax", "refund_tax"),
    totalCollected: moneyValue(exact(v.captured, v.refunded, true)),
    confirmedOrders: v.orders,
    averageOrderValue: moneyValue(
      v.missing_values ? null : divide(v.order_value, v.orders),
      v.missing_values,
    ),
    medianOrderValue: moneyValue(
      v.missing_values ? null : divide(v.middle_sum, v.middle_count),
      v.missing_values,
    ),
    orderValueBins: valueBins.map((minimumCents, i) => ({
      minimumCents,
      maximumCentsExclusive: valueBins[i + 1] ?? null,
      confirmedOrders: v["bin_" + i],
    })),
    missingOrderValues: v.missing_values,
    units: v.missing_lines ? null : v.units,
    netUnits:
      v.missing_returns || v.missing_lines ? null : exact(v.units, v.returned, true),
    missingReturnQuantities: v.missing_returns,
    buyers: { known: v.buyers, missingOrders: v.missing_buyers },
    attribution: {
      eligibleOrders: v.eligible_orders,
      attributedOrders: v.attributed_orders,
    },
    recordedCogs: knownMoney(cogs, v.known_costs, v.missing_costs),
    recordedProfit: knownMoney(
      profit,
      v.known_profit,
      exact(v.missing_costs, v.missing_profit),
    ),
    costCoverage: {
      orders: rate(v.covered_orders, v.orders),
      lines: rate(v.covered_lines, v.missing_lines ? null : v.lines),
      revenue: rate(v.costed_revenue, v.missing_values ? null : v.order_value),
    },
    shippingContribution: moneyValue(
      v.missing_labels || netShipping.cents === null
        ? null
        : exact(netShipping.cents, v.label_cost, true),
      exact(v.missing_labels, netShipping.missingCount),
    ),
    fees: knownMoney(v.fees, v.known_fees, v.missing_fees),
  };
}
export function mapSalesResult(raw: unknown): SalesData {
  const input = reportInput.parse(raw);
  return {
    ...readSalesPeriod(input.summary),
    comparison: hasComparison(input) ? readSalesPeriod(input.comparison) : null,
    series: readSalesBuckets(input.series, input.request, false, input.activatedAt),
    comparisonSeries: input.request.compare
      ? readSalesBuckets(input.comparisonSeries, input.request, true, input.activatedAt)
      : null,
  };
}
const paymentColumns = [
  "method",
  "paid_orders",
  "original_value",
  "bad_paid",
  "revenue",
  "missing_revenue",
  "known_revenue",
  "fees",
  "known_fees",
  "missing_fees",
  "succeeded",
  "failed",
  "pending",
];
export function readPaymentsPeriod(raw: unknown, request: ReportRequest): PaymentsPeriod {
  const allRows = rows(
    raw,
    [...paymentColumns, "eligible_orders", "attributed_orders"],
    7,
  );
  const evidence = allRows.filter((r) => r.method === "coverage");
  if (
    evidence.length !== 1 ||
    paymentColumns.slice(1).some((k) => integer(evidence[0][k]) !== 0)
  )
    throw new RangeError("Invalid method coverage.");
  const scope = attribution(evidence[0]);
  const aggregates = allRows.filter((r) => r.method !== "coverage");
  const methods = new Set<string>();
  const parsed = aggregates.map((row) => {
    const method = REPORT_FILTER_VALUES.paymentMethod.find((m) => m === row.method);
    if (!method || methods.has(method))
      throw new RangeError("Invalid payment method rows.");
    methods.add(method);
    const v: Totals = {};
    for (const key of paymentColumns.slice(1))
      v[key] = ["succeeded", "failed", "pending"].includes(key)
        ? count(row[key])
        : decimalText(row[key], key === "fees" || key === "revenue");
    if (v.bad_paid > v.paid_orders)
      throw new RangeError("Invalid paid order denominator.");
    return { method, v };
  });
  const paidOrders = parsed.reduce((total, r) => exact(total, r.v.paid_orders), 0);
  let resolvedAttempts = 0,
    pendingAttempts = 0;
  const methodRows: PaymentRow[] = parsed.map(({ method, v }) => {
    const resolved = exact(v.succeeded, v.failed);
    resolvedAttempts = exact(resolvedAttempts, resolved);
    pendingAttempts = exact(pendingAttempts, v.pending);
    return {
      method,
      paidOrders: v.paid_orders,
      paidOrderShare: rate(v.paid_orders, paidOrders),
      resolvedAttempts: resolved,
      successfulAttempts: v.succeeded,
      failedAttempts: v.failed,
      pendingAttempts: v.pending,
      successRate: rate(v.succeeded, resolved),
      revenue: knownMoney(v.revenue, v.known_revenue, v.missing_revenue),
      averageOrderValue: moneyValue(
        v.bad_paid ? null : divide(v.original_value, v.paid_orders),
        v.bad_paid,
      ),
      fees: knownMoney(v.fees, v.known_fees, v.missing_fees),
    };
  });
  const sortValue = (row: PaymentRow) =>
    request.sort === "revenue"
      ? row.revenue.cents
      : request.sort === "fees"
        ? row.fees.cents
        : request.sort === "successRate"
          ? row.successRate.value
          : row.paidOrders;
  methodRows.sort(
    (a, b) =>
      (sortValue(b) ?? -Infinity) - (sortValue(a) ?? -Infinity) ||
      a.method.localeCompare(b.method),
  );
  const { page, pageSize } = request;
  return {
    attribution: scope,
    paidOrders,
    resolvedAttempts,
    pendingAttempts,
    methods: {
      rows: methodRows.slice((page - 1) * pageSize, page * pageSize),
      totalCount: methodRows.length,
      page,
      pageSize,
    },
  };
}
export function mapPaymentsResult(raw: unknown): PaymentsData {
  const input = reportInput.parse(raw);
  return {
    ...readPaymentsPeriod(input.summary, input.request),
    comparison: hasComparison(input)
      ? readPaymentsPeriod(input.comparison, input.request)
      : null,
  };
}
