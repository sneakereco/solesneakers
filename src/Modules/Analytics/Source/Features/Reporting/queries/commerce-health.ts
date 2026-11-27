import "server-only";
import { factPayloadSchemas, type DatasetScope } from "../../CommerceFacts/contract";
import type {
  HealthData,
  HealthPeriod,
  ReportRequest,
  FunnelStep,
} from "../../ReportContract/types";
import type { CompiledReportQueries } from "../query-contract";
import {
  attributionSql,
  attribution,
  commerceSourceSql,
  endpoint,
  compileEndpoint,
  textField as field,
  instant,
  rows,
  count,
  rate,
  reportInput,
  hasComparison,
} from "./commerce-source";

const elapsed = `dateDiff('second',${instant(field("paidAt"))},${instant(field("fulfilledAt"))})`;
const sql = `${commerceSourceSql}, health_state AS (
 SELECT *, ${field("method")} AS delivery_method, ${field("state")} AS delivery_state, ${elapsed} AS seconds_elapsed
 FROM selected WHERE kind='fulfillment'
), durations AS (
 SELECT delivery_method, seconds_elapsed, row_number() OVER (PARTITION BY delivery_method ORDER BY seconds_elapsed,fact_id) AS position,
 count(*) OVER (PARTITION BY delivery_method) AS population FROM health_state
 WHERE delivery_state IN ('shipped','fulfilled','picked_up','delivered') AND seconds_elapsed>=0
), health_groups AS (
SELECT 'outcome' AS section, ${field("stage")} AS first_key,${field("outcome")} AS second_key,${field("reason")} AS third_key,count(*) AS observations,0 AS middle_sum,0 AS middle_count,0 AS p90
FROM selected WHERE kind='payment_attempt' GROUP BY first_key,second_key,third_key
UNION ALL
SELECT 'preference',coalesce(${field("fulfillment")},'unknown'),'','',count(*),0,0,0 FROM selected WHERE kind='order' GROUP BY coalesce(${field("fulfillment")},'unknown')
UNION ALL
SELECT 'state',delivery_method,delivery_state,'',count(*),0,0,0 FROM health_state GROUP BY delivery_method,delivery_state
UNION ALL
SELECT 'duration',delivery_method,'','',count(*),
 sum(CASE WHEN 2*position BETWEEN population AND population+2 THEN accurateCastOrNull(seconds_elapsed,'Decimal128(0)') ELSE 0 END),
 sum(CASE WHEN 2*position BETWEEN population AND population+2 THEN 1 ELSE 0 END),
 max(CASE WHEN 10*(position-1)<9*population AND 10*position>=9*population THEN seconds_elapsed ELSE 0 END)
 FROM durations GROUP BY delivery_method
UNION ALL
SELECT 'missing_duration','','','',count(*),0,0,0 FROM health_state WHERE delivery_state IN ('shipped','fulfilled','picked_up','delivered') AND (seconds_elapsed IS NULL OR seconds_elapsed<0)
UNION ALL
SELECT 'missing_state','','','',count(),0,0,0 FROM selected o LEFT JOIN health_state f ON o.order_id=f.order_id WHERE o.kind='order' AND nullIf(f.fact_id,'') IS NULL
 ) SELECT *,${attributionSql} FROM health_groups`;
export const commerceHealthEndpoints = [endpoint("sole_analytics_health", sql)];
export function compileCommerceHealthQueries(
  request: ReportRequest,
  scope: DatasetScope,
): CompiledReportQueries {
  if (request.report !== "health") throw new RangeError("Unknown operational report.");
  return {
    queries: {
      summary: compileEndpoint(commerceHealthEndpoints[0], request, scope, {
        limit: 512,
      }),
      ...(request.compare
        ? {
            comparison: compileEndpoint(commerceHealthEndpoints[0], request, scope, {
              comparison: true,
              limit: 512,
            }),
          }
        : {}),
    },
  };
}
export function readHealthPeriod(
  raw: unknown,
  request: ReportRequest,
  warehouseObserved = true,
): HealthPeriod {
  const values = rows(
    raw,
    [
      "section",
      "first_key",
      "second_key",
      "third_key",
      "observations",
      "middle_sum",
      "middle_count",
      "p90",
      "eligible_orders",
      "attributed_orders",
    ],
    512,
  );
  if (!values.length) throw new RangeError("Missing operational evidence.");
  const data = {
    attribution: attribution(values[0]),
    outcomes: [] as NonNullable<HealthPeriod["outcomes"]>,
    backlog: [] as NonNullable<HealthPeriod["backlog"]>,
    paymentToFulfillment: [] as NonNullable<HealthPeriod["paymentToFulfillment"]>,
    fulfillmentPreference: { ship: 0, pickup: 0, unknown: 0 },
    fulfillmentDateBasis: "latest-state-of-orders-confirmed-in-range",
    missingFulfillmentDurations: 0,
    missingFulfillmentStates: 0,
    checkoutCompletion: rate(null, null),
    funnel: (
      [
        "session",
        "product-view",
        "cart-addition",
        "checkout",
        "purchase",
      ] as FunnelStep["step"][]
    ).map((step) => ({
      step,
      sessions: null,
      fromStart: rate(null, null),
      fromPrevious: rate(null, null),
    })),
  } satisfies HealthPeriod;
  const seen = new Set<string>();
  for (const row of values) {
    const { section, first_key: a, second_key: b, third_key: c } = row;
    if ([section, a, b, c].some((k) => typeof k !== "string"))
      throw new RangeError("Invalid operational dimension.");
    const key = JSON.stringify([section, a, b, c]);
    if (seen.has(key)) throw new RangeError("Duplicate operational group.");
    seen.add(key);
    const n = count(row.observations),
      sum = count(row.middle_sum),
      middle = count(row.middle_count),
      p90 = count(row.p90);
    if (section !== "duration" && (sum || middle || p90))
      throw new RangeError("Unexpected operational statistic.");
    switch (section) {
      case "outcome": {
        const s = factPayloadSchemas.payment_attempt.shape;
        data.outcomes.push({
          stage: s.stage.parse(a),
          outcome: s.outcome.parse(b),
          reason: s.reason.parse(c),
          count: n,
        });
        break;
      }
      case "preference":
        if (a !== "ship" && a !== "pickup" && a !== "unknown")
          throw new RangeError("Unexpected preference.");
        data.fulfillmentPreference[a] = n;
        break;
      case "state":
        data.backlog.push({
          fulfillment: factPayloadSchemas.fulfillment.shape.method.parse(a),
          state: factPayloadSchemas.fulfillment.shape.state.parse(b),
          count: n,
        });
        break;
      case "duration":
        if (!n || middle !== (n % 2 ? 1 : 2))
          throw new RangeError("Invalid time distribution.");
        data.paymentToFulfillment.push({
          fulfillment: factPayloadSchemas.fulfillment.shape.method.parse(a),
          fulfilledOrders: n,
          medianSeconds: sum / middle,
          p90Seconds: p90,
        });
        break;
      case "missing_state":
        data.missingFulfillmentStates = n;
        break;
      case "missing_duration":
        data.missingFulfillmentDurations = n;
        break;
      default:
        throw new RangeError("Unexpected operational row.");
    }
  }
  if (
    !seen.has(JSON.stringify(["missing_state", "", "", ""])) ||
    !seen.has(JSON.stringify(["missing_duration", "", "", ""]))
  )
    throw new RangeError("Missing operational coverage.");
  const byCountOrState = (
    left: { state: string; count: number },
    right: { state: string; count: number },
  ) =>
    (request.sort === "count" ? right.count - left.count : 0) ||
    left.state.localeCompare(right.state);
  data.backlog.sort(
    (a, b) => byCountOrState(a, b) || a.fulfillment.localeCompare(b.fulfillment),
  );
  data.outcomes.sort(
    (a, b) =>
      byCountOrState(
        { state: a.outcome, count: a.count },
        { state: b.outcome, count: b.count },
      ) ||
      a.stage.localeCompare(b.stage) ||
      a.reason.localeCompare(b.reason),
  );
  data.paymentToFulfillment.sort((a, b) => a.fulfillment.localeCompare(b.fulfillment));
  if (warehouseObserved) return data;
  const hasOrders = Object.values(data.fulfillmentPreference).some((n) => n > 0);
  return {
    ...data,
    attribution: data.attribution.eligibleOrders ? data.attribution : null,
    outcomes: data.outcomes.length ? data.outcomes : null,
    backlog: data.backlog.length ? data.backlog : null,
    paymentToFulfillment: data.paymentToFulfillment.length
      ? data.paymentToFulfillment
      : null,
    fulfillmentPreference: hasOrders ? data.fulfillmentPreference : null,
    missingFulfillmentStates: hasOrders ? data.missingFulfillmentStates : null,
    missingFulfillmentDurations: data.missingFulfillmentDurations || null,
  };
}
export function mapHealthResult(raw: unknown, warehouseObserved = true): HealthData {
  const input = reportInput.parse(raw);
  return {
    ...readHealthPeriod(input.summary, input.request, warehouseObserved),
    comparison: hasComparison(input)
      ? readHealthPeriod(input.comparison, input.request, warehouseObserved)
      : null,
  };
}
