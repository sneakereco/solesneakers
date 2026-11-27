import "server-only";
import type { DatasetScope } from "../../CommerceFacts/contract";
import type {
  ReportRequest,
  ProductRow,
  ProductBreakdownRow,
} from "../../ReportContract/types";
import { moneyValue } from "../../ReportContract/money";
import {
  endpoint,
  compileEndpoint,
  commerceSourceSql,
  rows,
  count,
  integer,
  rate,
  decimalText,
  centsField as amount,
  textField as str,
  attributionSql,
  attribution,
  observedWarehouseMoney,
} from "./commerce-source";
import { evidenceSql, unknownReturn } from "./financial";
import {
  observationSql,
  devicePredicate,
  segmentPredicate,
  invalidTimingCount,
  purchaseInSession,
  eligibleSessionEntry,
} from "./behavior-source";
import type { CompiledReportQueries, CsvExecution } from "../query-contract";

const ids = ["product", "variant", "brand", "category", "size"] as const;
const axes = ["product", "variant", "brand", "category", "size"] as const;
const idFilters = (fields: string[]) =>
  ids
    .map(
      (k, i) =>
        "({variables." + k + "id}='' OR " + fields[i] + "={variables." + k + "id})",
    )
    .join(" AND ");
const snapshotIds = ids.map((k) => str(k + "Id", "snapshot"));
const snapshotLabels = ["productName", "brandLabel", "categoryLabel", "sizeLabel"].map(
  (k) => str(k, "snapshot"),
);
const factsSql = `${commerceSourceSql}${evidenceSql}, originals AS (
 SELECT order_id AS line_order,${str("lineId")} AS original_id,payload AS snapshot FROM facts WHERE kind='line'
 ), missing_allocation AS (
 SELECT count(DISTINCT CASE WHEN b.kind='order' AND (b.incomplete_original_lines=1 OR b.order_id IN (SELECT line_order FROM originals WHERE ${str("productId", "snapshot")} IS NULL)) THEN b.order_id END) AS unassigned_orders,
 count(DISTINCT CASE WHEN (${unknownReturn}) OR (b.kind='refund' AND ${amount("merchandiseCents")} IS NULL) OR
 (b.kind='refund_line' AND nullIf(o.original_id,'') IS NULL) THEN concat(b.order_id,':',${str("refundId", "b.payload")}) END) AS unassigned_returns
 FROM basis b LEFT JOIN originals o ON b.kind='refund_line' AND b.order_id=o.line_order AND ${str("lineId", "b.payload")}=o.original_id AND ${str("productId", "o.snapshot")} IS NOT NULL
 ), line_flows AS (
 SELECT b.*,o.snapshot AS snapshot,'sale' AS action FROM basis b JOIN originals o ON b.order_id=o.line_order AND ${str("lineId", "b.payload")}=o.original_id WHERE b.kind='line'
 UNION ALL SELECT b.*,o.snapshot,'return' FROM basis b JOIN originals o ON b.order_id=o.line_order AND ${str("lineId", "b.payload")}=o.original_id WHERE b.kind='refund_line'
 UNION ALL SELECT b.*,o.snapshot,'incomplete' FROM basis b JOIN originals o ON b.order_id=o.line_order WHERE ${unknownReturn}
 ), purchased AS (
 SELECT ${snapshotIds.map((s, i) => s + " AS " + ids[i] + "_id").join(",")},${snapshotLabels.map((s, i) => s + " AS " + ["name", "brand", "category", "size"][i] + "_label").join(",")}, order_id,confirmed_at,action,report_at,
 CASE WHEN action='sale' THEN ${amount("quantity")} ELSE 0 END AS units,
 CASE WHEN action='return' THEN ${amount("quantity")} ELSE 0 END AS returned,
 CASE WHEN action='sale' THEN ${amount("merchandiseCents")} WHEN action='return' THEN -${amount("merchandiseCents")} ELSE 0 END AS revenue,
 CASE WHEN bad_lines=1 OR action='incomplete' OR ${amount("merchandiseCents")} IS NULL THEN 1 ELSE 0 END AS missing_revenue,
 CASE WHEN incomplete_original_lines=1 OR action='incomplete' OR (action='return' AND ${amount("quantity")} IS NULL) THEN 1 ELSE 0 END AS missing_units
 FROM line_flows WHERE ${idFilters(snapshotIds)}
 ), inventory AS (
 SELECT ${str("productId")} AS product_id,${str("variantId")} AS variant_id,${amount("availableUnits")} AS stock,recorded_at
 FROM facts WHERE kind='inventory' AND {variables.inventory_enabled}='yes' AND ${str("variantId")} IS NOT NULL AND (${idFilters([str("productId"), str("variantId"), "NULL", "NULL", "NULL"])} OR ${str("variantId")} IN (SELECT ${str("variantId", "snapshot")} FROM originals WHERE ${idFilters(snapshotIds)}))
 )`;
function productSql(scope: DatasetScope) {
  const source = `${factsSql},${observationSql(scope)}, measured AS (SELECT * FROM valid_events WHERE ${devicePredicate} AND ${segmentPredicate("session")} AND ${idFilters(["product_id", "variant_id", "NULL", "NULL", "NULL"])}),
 views AS (SELECT product_id,toString(session_id) AS sid,min(occurred_at) AS first_view,min(entered_at) AS entry_time,count(*) AS views FROM measured WHERE event_name='product_viewed' GROUP BY product_id,sid),
 purchased_sessions AS (SELECT p.product_id,toString(l.session_id) AS sid,max(p.confirmed_at) AS bought_at FROM purchased p JOIN ranked_links l ON p.order_id=toString(l.order_id) AND l.active=1 AND l.link_rank=1 JOIN session_entries anchor ON toString(anchor.session_id)=toString(l.session_id) WHERE action='sale' AND ${purchaseInSession("p.confirmed_at", "anchor.entered_at")} GROUP BY p.product_id,sid),
 activity AS (SELECT product_id,variant_id,brand_id,category_id,size_id,name_label,brand_label,category_label,size_label,
 CASE WHEN action='sale' THEN order_id ELSE NULL END AS oid,units,returned,revenue,missing_revenue,missing_units,NULL AS view_sid,0 AS views,NULL AS bought_sid,NULL AS stock,NULL AS stock_time,NULL AS demand,CASE WHEN action!='incomplete' AND revenue IS NOT NULL THEN 1 ELSE 0 END AS known_revenue
 FROM purchased
 UNION ALL SELECT v.product_id,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,0,0,CASE WHEN ${eligibleSessionEntry("v.entry_time")} THEN v.sid ELSE NULL END,v.views,CASE WHEN p.bought_at>=v.first_view THEN v.sid ELSE NULL END,NULL,NULL,NULL,0
 FROM views v LEFT JOIN purchased_sessions p ON v.product_id=p.product_id AND v.sid=p.sid
 UNION ALL SELECT product_id,variant_id,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,0,0,NULL,0,NULL,stock,recorded_at,NULL,0 FROM inventory
 UNION ALL SELECT product_id,variant_id,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,0,0,0,0,NULL,0,NULL,NULL,NULL,event_name,0 FROM measured WHERE event_name IN ('product_added_to_cart','variant_selected','unavailable_size_requested','out_of_stock_viewed')
 ), axes AS (${axes.map((k) => "SELECT '" + k + "' AS axis").join(" UNION ALL ")}),
 grouped AS (SELECT axis,CASE axis ${axes.map((k) => "WHEN '" + k + "' THEN " + k + "_id").join(" ")} END AS item,
 CASE axis WHEN 'product' THEN min(name_label) WHEN 'variant' THEN min(name_label) WHEN 'brand' THEN min(brand_label) WHEN 'category' THEN min(category_label) ELSE min(size_label) END AS label,
 min(product_id) AS pid,min(brand_id) AS brand,min(brand_label) AS brand_name,min(category_id) AS category,min(category_label) AS category_name,min(size_id) AS size,min(size_label) AS size_name,
 count(DISTINCT oid) AS orders,sum(units) AS sold,sum(units)-sum(returned) AS net_units,sum(revenue) AS net,sum(missing_revenue) AS missing,sum(missing_units) AS unknown_units,
 sum(known_revenue) AS known_money,count(CASE WHEN demand='product_added_to_cart' THEN 1 END) AS additions,count(CASE WHEN demand='variant_selected' THEN 1 END) AS selections,count(CASE WHEN demand='unavailable_size_requested' THEN 1 END) AS requests,count(CASE WHEN demand='out_of_stock_viewed' THEN 1 END) AS stockouts,
 sum(views) AS views,count(DISTINCT view_sid) AS viewed,count(DISTINCT bought_sid) AS converted,
 CASE WHEN count(stock_time)>0 AND count(stock_time)=count(stock) THEN sum(stock) ELSE NULL END AS stock
 FROM activity CROSS JOIN axes WHERE CASE axis ${axes.map((k) => "WHEN '" + k + "' THEN " + k + "_id").join(" ")} END IS NOT NULL GROUP BY axis,item),
 ranked AS (SELECT *,row_number() OVER(PARTITION BY axis ORDER BY CASE {variables.sort} WHEN 'units' THEN sold WHEN 'netUnits' THEN net_units WHEN 'views' THEN views WHEN 'confirmedOrders' THEN orders ELSE net END DESC,item) AS ranking FROM grouped),
 totals AS (SELECT axis,count(*) AS total FROM grouped GROUP BY axis)
 SELECT a.axis AS axis,nullIf(r.item,'') AS item,r.label AS label,r.pid AS pid,r.brand AS brand,r.brand_name AS brand_name,r.category AS category,r.category_name AS category_name,r.size AS size,r.size_name AS size_name,
 r.orders AS orders,r.sold AS sold,r.net_units AS net_units,toString(r.net) AS net,r.missing AS missing,r.unknown_units AS unknown_units,r.views AS views,r.viewed AS viewed,r.converted AS converted,r.stock AS stock,r.known_money AS known_money,r.additions AS additions,r.selections AS selections,r.requests AS requests,r.stockouts AS stockouts,
 coalesce(t.total,0) AS total,${attributionSql},(SELECT unassigned_orders FROM missing_allocation) AS unassigned_orders,(SELECT unassigned_returns FROM missing_allocation) AS unassigned_returns,${invalidTimingCount(devicePredicate + " AND " + segmentPredicate("session") + " AND " + idFilters(["product_id", "variant_id", "NULL", "NULL", "NULL"]))} AS invalid_events FROM axes a LEFT JOIN totals t ON a.axis=t.axis LEFT JOIN ranked r ON a.axis=r.axis AND r.ranking>toInt({variables.page_start}) AND r.ranking<=toInt({variables.page_end}) ORDER BY a.axis,r.ranking`;
  const signals = `${factsSql},${observationSql(scope)}, measured AS (SELECT * FROM valid_events WHERE ${devicePredicate} AND ${segmentPredicate("session")} AND ${idFilters(["product_id", "variant_id", "NULL", "NULL", "NULL"])}),
 stock AS (SELECT count(*) AS variants,count(stock) AS known,sum(stock) AS units,count(CASE WHEN stock>0 THEN 1 END) AS in_stock,count(CASE WHEN stock=0 THEN 1 END) AS out_stock,max(recorded_at) AS last_stock FROM inventory)
 SELECT variants,known,units,in_stock,out_stock,toString(last_stock) AS last_stock,${invalidTimingCount(devicePredicate + " AND " + segmentPredicate("session") + " AND " + idFilters(["product_id", "variant_id", "NULL", "NULL", "NULL"]))} AS invalid_events,
 ${["out_of_stock_viewed", "unavailable_size_requested", "variant_selected", "catalog_search_results"].map((k, i) => "(SELECT count(*) FROM measured WHERE event_name='" + k + "') AS " + ["stockouts", "unavailable", "selections", "searches"][i]).join(",")},
 (SELECT count(*) FROM measured WHERE event_name='catalog_search_results' AND result_count=0) AS no_results FROM stock`;
  return { source, signals };
}
export function productEndpoints(scope: DatasetScope) {
  const { source, signals } = productSql(scope);
  return [
    endpoint("sole_analytics_products", source),
    endpoint("sole_analytics_inventory_demand", signals),
  ];
}
export function compileProductQueries(
  request: ReportRequest,
  scope: DatasetScope,
  mode?: CsvExecution,
): CompiledReportQueries {
  const [table, signals] = productEndpoints(scope);
  return {
    queries: {
      products: compileEndpoint(table, request, scope, {
        limit: request.pageSize * 5,
        mode,
      }),
      ...(request.report === "overview"
        ? {}
        : { signals: compileEndpoint(signals, request, scope, { limit: 1 }) }),
    },
  };
}
const names = [
  "axis",
  "item",
  "label",
  "pid",
  "brand",
  "brand_name",
  "category",
  "category_name",
  "size",
  "size_name",
  "orders",
  "sold",
  "net_units",
  "net",
  "missing",
  "unknown_units",
  "views",
  "viewed",
  "converted",
  "stock",
  "known_money",
  "additions",
  "selections",
  "requests",
  "stockouts",
  "total",
  "eligible_orders",
  "attributed_orders",
  "unassigned_orders",
  "unassigned_returns",
  "invalid_events",
];
export function readProductRows(
  raw: unknown,
  request: ReportRequest,
  behavior: boolean,
  warehouseObserved = true,
) {
  const records = rows(raw, names, request.pageSize * 5);
  const hasTaxonomy = !!(request.brandId || request.categoryId || request.sizeId);
  function page<T>(axis: string, fn: (r: Record<string, unknown>) => T) {
    const recordsForAxis = records.filter((r) => r.axis === axis);
    if (!recordsForAxis.length) throw new RangeError("Missing product axis.");
    return {
      rows: recordsForAxis.filter((r) => r.item !== null && r.item !== undefined).map(fn),
      totalCount: count(recordsForAxis[0].total),
      page: request.page,
      pageSize: request.pageSize,
    };
  }
  function metrics(r: Record<string, unknown>) {
    const tracked =
      behavior && r.axis === "product" && !request.variantId && !hasTaxonomy;
    const orders = count(r.orders),
      sold = count(r.sold),
      netUnits = count(r.unknown_units) ? null : integer(r.net_units),
      knownAmounts = count(r.known_money),
      missingAmounts = count(r.missing);
    return {
      confirmedOrders: warehouseObserved ? orders : orders || null,
      units: warehouseObserved ? sold : sold || null,
      netUnits: warehouseObserved || sold ? netUnits : netUnits || null,
      views: tracked ? count(r.views) : null,
      viewToPurchase: tracked
        ? rate(warehouseObserved ? count(r.converted) : null, count(r.viewed))
        : rate(null, null),
      netMerchandise: observedWarehouseMoney(
        moneyValue(
          knownAmounts ? decimalText(r.net, true) : missingAmounts ? null : 0,
          missingAmounts,
        ),
        warehouseObserved,
        knownAmounts > 0,
      ),
    };
  }
  function product(r: Record<string, unknown>): ProductRow {
    const ref = (key: string) =>
      typeof r[key] === "string"
        ? { id: String(r[key]), label: String(r[key + "_name"] ?? "Unknown") }
        : null;
    if (typeof r.pid !== "string") throw new RangeError("Invalid product reference.");
    return {
      ...metrics(r),
      successfulAdditions: behavior && !hasTaxonomy ? count(r.additions) : null,
      variantSelections: behavior && !hasTaxonomy ? count(r.selections) : null,
      unavailableSizeRequests: behavior && !hasTaxonomy ? count(r.requests) : null,
      stockoutViews:
        behavior && !hasTaxonomy && r.axis === "product" && !request.variantId
          ? count(r.stockouts)
          : null,
      productId: r.pid,
      variantId: r.axis === "variant" ? String(r.item) : null,
      name: String(r.label ?? "Unknown product"),
      brand: ref("brand"),
      category: ref("category"),
      size: r.axis === "variant" ? ref("size") : null,
      availableUnits: r.stock === null || r.stock === undefined ? null : count(r.stock),
    };
  }
  function breakdown(r: Record<string, unknown>): ProductBreakdownRow {
    return { ...metrics(r), id: String(r.item), label: String(r.label ?? "Unknown") };
  }
  const orderCoverage = attribution(records[0]);
  return {
    invalidEvents: count(records[0].invalid_events),
    unassignedOrders: count(records[0].unassigned_orders),
    unassignedReturns: count(records[0].unassigned_returns),
    attribution: warehouseObserved || orderCoverage.eligibleOrders ? orderCoverage : null,
    products: page("product", product),
    variants: page("variant", product),
    brands: page("brand", breakdown),
    categories: page("category", breakdown),
    sizes: page("size", breakdown),
  };
}
export function readDemand(raw: unknown, request: ReportRequest, behavior: boolean) {
  const [r] = rows(
    raw,
    [
      "variants",
      "known",
      "units",
      "in_stock",
      "out_stock",
      "last_stock",
      "invalid_events",
      "stockouts",
      "unavailable",
      "selections",
      "searches",
      "no_results",
    ],
    1,
  );
  if (!r) throw new RangeError("Missing inventory coverage.");
  const recordedVariants = count(r.variants);
  const knownStockVariants = count(r.known);
  if (knownStockVariants > recordedVariants)
    throw new RangeError("Invalid inventory coverage.");
  const available = recordedVariants > 0 && recordedVariants === knownStockVariants;
  const applicable =
    behavior && !request.brandId && !request.categoryId && !request.sizeId;
  return {
    invalidEvents: count(r.invalid_events),
    inventory: {
      scope: "recorded-variants" as const,
      recordedVariants,
      missingStockVariants: recordedVariants - knownStockVariants,
      catalogVariants: null,
      asOf:
        r.last_stock === null || r.last_stock === undefined ? null : String(r.last_stock),
      availableUnits: available ? count(r.units) : null,
      inStockVariants: available ? count(r.in_stock) : null,
      outOfStockVariants: available ? count(r.out_stock) : null,
    },
    unmetDemand: {
      stockoutSignals: applicable && !request.variantId ? count(r.stockouts) : null,
      unavailableSizeSelections: applicable ? count(r.unavailable) : null,
      variantSelections: applicable ? count(r.selections) : null,
      searches:
        applicable && !request.productId && !request.variantId ? count(r.searches) : null,
      searchesWithNoResults:
        applicable && !request.productId && !request.variantId
          ? count(r.no_results)
          : null,
    },
  };
}
