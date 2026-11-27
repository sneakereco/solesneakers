import "server-only";
import type {
  ReportDataMap,
  ReportEnvelope,
  ReportId,
  ReportRequest,
} from "../ReportContract/types";

import {
  CSV_AXIS_LIMIT,
  rankedExportAxes,
  ExportScopeError,
  type CompiledQuery,
} from "./query-contract";
export { ExportScopeError } from "./query-contract";
const narrow = () => new ExportScopeError();
/** Each empty axis emits a sentinel instead of a data row; aggregate diagnostics
 * are columns on those same rows. A full axis therefore needs exactly 5,000 slots. */
export function checkRankedExport(q: CompiledQuery, raw: unknown) {
  const axes = rankedExportAxes[q.endpoint];
  if (!axes || q.variables.page_end !== String(CSV_AXIS_LIMIT)) return;
  if (
    !raw ||
    typeof raw !== "object" ||
    !("columns" in raw) ||
    !Array.isArray(raw.columns) ||
    !("results" in raw) ||
    !Array.isArray(raw.results) ||
    !("hasMore" in raw) ||
    raw.hasMore !== false
  )
    throw narrow();
  const axisIndex = raw.columns.indexOf("axis"),
    idIndex = raw.columns.indexOf(
      q.endpoint === "sole_analytics_products" ? "item" : "label",
    ),
    totalIndex = raw.columns.indexOf("total");
  if (Math.min(axisIndex, idIndex, totalIndex) < 0 || raw.results.length > q.limit)
    throw narrow();
  const groups = new Map<string, { total: number; ids: Set<string>; rows: number }>();
  for (const row of raw.results) {
    if (!Array.isArray(row)) throw narrow();
    const name = row[axisIndex],
      id = row[idIndex],
      value = row[totalIndex];
    const total =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+$/.test(value)
          ? Number(value)
          : NaN;
    if (
      !axes.includes(name) ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      total > CSV_AXIS_LIMIT
    )
      throw narrow();
    const group = groups.get(name) ?? { total, ids: new Set<string>(), rows: 0 };
    if (
      group.total !== total ||
      (total === 0 ? id !== null : typeof id !== "string" || group.ids.has(id))
    )
      throw narrow();
    if (id !== null) group.ids.add(id);
    group.rows++;
    groups.set(name, group);
  }
  for (const axis of axes) {
    const group = groups.get(axis);
    if (
      !group ||
      group.rows !== Math.max(1, group.total) ||
      group.ids.size !== group.total
    )
      throw narrow();
  }
}
// Only declared DTO fields may enter an export, including nested rows and metadata.
interface Fields {
  [name: string]: true | Fields;
}
const fields = (names: string): Fields =>
  Object.fromEntries(names.split(" ").map((k) => [k, true]));
const rate = fields("numerator denominator value"),
  money = fields("cents complete missingCount");
const attribution = fields("eligibleOrders attributedOrders");
const range = fields(
  "from to timezone startInclusive endExclusive calendarDays comparisonStartInclusive comparisonEndExclusive partial",
);
const filters = fields(
  "device source channel campaign paymentMethod fulfillment productId variantId brandId categoryId sizeId customer status",
);
const series = {
  ...fields("startInclusive endExclusive confirmedOrders sessions visitors"),
  netMerchandise: money,
};
const funnel = { ...fields("step sessions"), fromStart: rate, fromPrevious: rate };
const source = {
  ...fields("key label sessions purchasingSessions confirmedOrders"),
  revenue: money,
};
const taxonomy = fields("id label");
const breakdown = {
  ...fields("confirmedOrders units netUnits views"),
  viewToPurchase: rate,
  netMerchandise: money,
};
const product = {
  ...breakdown,
  ...fields(
    "successfulAdditions variantSelections unavailableSizeRequests stockoutViews productId variantId name availableUnits",
  ),
  brand: taxonomy,
  category: taxonomy,
  size: taxonomy,
};
const table = (rows: Fields): Fields => ({ ...fields("totalCount page pageSize"), rows });
const components: Fields = Object.fromEntries(
  "grossMerchandise discounts merchandiseRefunds shippingCollected shippingRefunds taxCollected taxRefunds unallocatedRefunds netMerchandise netShipping netTax totalCollected"
    .split(" ")
    .map((k) => [k, money]),
);
const summary = {
  ...fields("confirmedOrders visitors sessions buyers"),
  netMerchandise: money,
  averageOrderValue: money,
  conversion: rate,
};
const sales = {
  ...components,
  ...fields("confirmedOrders missingOrderValues missingReturnQuantities units netUnits"),
  attribution,
  buyers: fields("known missingOrders"),
  averageOrderValue: money,
  medianOrderValue: money,
  orderValueBins: fields("minimumCents maximumCentsExclusive confirmedOrders"),
  recordedCogs: money,
  recordedProfit: money,
  costCoverage: { revenue: rate, orders: rate, lines: rate },
  shippingContribution: money,
  fees: money,
};
const customers = {
  attribution,
  ...fields("visitors sessions buyers newBuyers returningBuyers missingBuyerOrders"),
  observedLifetimeSpend: money,
  selectedPeriodSpend: money,
  devices: table(fields("device visitors sessions")),
  cohorts: {
    ...fields("month buyers"),
    repeatPurchases: { ...fields("monthsSinceFirstPurchase"), repeatPurchaseRate: rate },
  },
};
const acquisitionView = {
  attribution,
  series,
  sources: table(source),
  channels: table(source),
  campaigns: table(source),
  placements: table(source),
};
const acquisition = { discovery: acquisitionView, purchaseSession: acquisitionView };
const products = {
  attribution,
  products: table(product),
  variants: table(product),
  brands: table({ ...taxonomy, ...breakdown }),
  categories: table({ ...taxonomy, ...breakdown }),
  sizes: table({ ...taxonomy, ...breakdown }),
  unmetDemand: fields(
    "stockoutSignals unavailableSizeSelections searchesWithNoResults searches variantSelections",
  ),
};
const methods = {
  ...fields(
    "method paidOrders resolvedAttempts successfulAttempts failedAttempts pendingAttempts",
  ),
  paidOrderShare: rate,
  successRate: rate,
  revenue: money,
  averageOrderValue: money,
  fees: money,
};
const payments = {
  attribution,
  methods: table(methods),
  ...fields("paidOrders resolvedAttempts pendingAttempts"),
};
const health = {
  attribution,
  ...fields("fulfillmentDateBasis missingFulfillmentStates missingFulfillmentDurations"),
  funnel,
  outcomes: fields("stage outcome reason count"),
  fulfillmentPreference: fields("ship pickup unknown"),
  backlog: fields("fulfillment state count"),
  paymentToFulfillment: fields("fulfillment fulfilledOrders medianSeconds p90Seconds"),
};
const byReport: Record<ReportId, Fields> = {
  overview: {
    summary,
    comparison: summary,
    series,
    comparisonSeries: series,
    funnel,
    leadingSources: source,
    leadingProducts: product,
    components,
  },
  sales: { ...sales, series, comparisonSeries: series, comparison: sales },
  customers: {
    ...customers,
    activeFiveMinuteVisitors: true,
    activeWindow: fields("start end"),
    comparison: customers,
  },
  acquisition: { ...acquisition, comparison: acquisition },
  products: {
    ...products,
    inventory: fields(
      "scope recordedVariants missingStockVariants catalogVariants asOf availableUnits inStockVariants outOfStockVariants",
    ),
    comparison: products,
  },
  payments: { ...payments, comparison: payments },
  health: { ...health, comparison: health },
};

function cell(value: string | number | boolean) {
  const text =
    typeof value === "string" && (/^\s*[=+@-]/u.test(value) || /^[\t\r\n]/.test(value))
      ? "'" + value
      : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

export function exportAnalyticsCsv(
  report: ReportEnvelope<ReportDataMap[ReportId]>,
  request: ReportRequest,
): { filename: string; body: string } {
  const lines = ["field,value,status"];
  let bytes = lines[0].length + 2;
  function add(path: string, value: string | number | boolean, status: string) {
    const line = [cell(path), cell(value), cell(status)].join(",");
    bytes += Buffer.byteLength(line) + 2;
    if (bytes > 8 * 1024 * 1024 || lines.length >= 150000) throw narrow();
    lines.push(line);
  }
  function visit(path: string, value: unknown, schema: true | Fields) {
    if (value === null || value === undefined) {
      add(path, "", "unavailable");
      return;
    }
    if (schema === true) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      )
        add(path, value, "observed");
      else throw narrow();
      return;
    }
    if (Array.isArray(value)) {
      if (!value.length) add(path, "", "empty");
      value.forEach((row, i) => visit(path + "[" + i + "]", row, schema));
      return;
    }
    if (typeof value !== "object") throw narrow();
    const record = value as Record<string, unknown>;
    if (
      "rows" in schema &&
      (!Array.isArray(record.rows) ||
        record.page !== 1 ||
        record.rows.length !== record.totalCount)
    )
      throw narrow();
    for (const [key, shape] of Object.entries(schema)) {
      if (Object.hasOwn(record, key)) visit(path + "." + key, record[key], shape);
    }
  }
  visit("request", request, {
    ...filters,
    ...fields("report compare bucket dateBasis page pageSize sort"),
  });
  visit("report", report, {
    range,
    ...fields("state asOf ingestionAsOf behaviorThrough datasetStartedAt"),
    scope: {
      dataset: fields("datasetId storefront environment currency"),
      dateBasis: true,
      filters,
      attribution: { ...attribution, ...fields("orderScope unattributedOrders") },
    },
    coverage: fields("code metric message filter missingCount"),
    data: byReport[request.report],
  });
  add("export.scope", "All available matching aggregate rows", "metadata");
  if (request.report === "overview")
    add("export.leaders", "Top five sources and products", "metadata");
  return {
    filename: `sole-${request.report}-${request.range.from}-${request.range.to}.csv`,
    body: lines.join("\r\n") + "\r\n",
  };
}
