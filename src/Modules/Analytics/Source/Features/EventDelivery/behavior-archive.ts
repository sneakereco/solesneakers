import "server-only";
import { datasetScopeSchema, type DatasetScope } from "../CommerceFacts/contract";
import {
  behaviorHistoryCoverage,
  type HistoryEvidence,
  type HistoryInterval,
} from "./history-source";
import scalar from "../CommerceFacts/fact-scalar-schemas.json";
import { DATASET_IDS } from "../Configuration/dataset";

// PostHog substitutes only the interval placeholders. Compile the trusted project
// scope once when provisioning the saved export definition.
const columns = [
  "dataset_id",
  "event_uuid",
  "event_name",
  "occurred_at",
  "visitor_id",
  "session_id",
  "pathname",
  "device",
  "product_id",
  "variant_id",
  "landing_pathname",
  "referrer_host",
  "discovery_source",
  "discovery_channel",
  "discovery_campaign",
  "discovery_placement",
  "session_source",
  "session_channel",
  "session_campaign",
  "session_placement",
] as const;
function nativeProjection(scope: DatasetScope, timePredicate: string): string {
  datasetScopeSchema.parse(scope);
  if (scope.datasetId !== DATASET_IDS[scope.environment] || scope.schemaVersion !== 2)
    throw new Error("Invalid archive scope");
  const activation = scope.activatedAt;
  const uuid = scalar.id.pattern;
  const visitor =
    "^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|sole-buyer:v1:[0-9a-f]{64})$";
  const path =
    "^(/|/(store|cart|checkout|hours|brands|contact|authenticity-guarantee|privacy|terms|refunds|shipping|legal/(privacy|terms|shipping|refunds))|/store/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$";
  const referrer = "^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,24}$";
  const unsafe =
    "([a-z0-9]{24,}|token|secret|password|auth|session|key|([0-9][ _-]?){7})";
  const slug = (field: string) =>
    `if(match(properties.${field}, '^[a-z0-9][a-z0-9_-]{0,63}$') AND NOT match(properties.${field}, '${unsafe}'), properties.${field}, NULL) AS ${field}`;
  const dimensions = ["discovery", "session"].flatMap((prefix) =>
    ["source", "channel", "campaign", "placement"].map((s) => slug(prefix + "_" + s)),
  );
  return `SELECT '${scope.datasetId}' AS dataset_id, uuid AS event_uuid, event AS event_name,
 timestamp AS occurred_at, distinct_id AS visitor_id, properties.$session_id AS session_id, properties.pathname AS pathname,
 if(properties.device IN ('desktop','mobile','tablet','unknown'),properties.device,NULL) AS device,
 if(event IN ('product_viewed','product_added_to_cart'),properties.product_id,NULL) AS product_id,
 if(event='product_added_to_cart',properties.variant_id,NULL) AS variant_id,
 if(match(properties.landing_pathname,'${path}'),properties.landing_pathname,NULL) AS landing_pathname,
 if(length(properties.referrer_host)<=253 AND match(properties.referrer_host,'${referrer}') AND NOT match(properties.referrer_host,'${unsafe}'),properties.referrer_host,NULL) AS referrer_host,
 ${dimensions.join(",\n ")}
 FROM events
 WHERE timestamp >= parseDateTime64BestEffort('${activation}',6,'UTC')
 AND ${timePredicate}
 AND properties.environment='${scope.environment}' AND properties.storefront='sole' AND properties.schema_version=2
 AND match(distinct_id,'${visitor}') AND match(properties.$session_id,'${uuid}') AND match(properties.pathname,'${path}')
 AND (event='public_page_viewed' OR (event='storefront_viewed' AND properties.pathname='/store')
 OR (event='checkout_started' AND properties.pathname='/checkout')
 OR (event IN ('product_viewed','product_added_to_cart') AND match(properties.product_id,'${uuid}')
 AND properties.pathname=concat('/store/',properties.product_id) AND (event='product_viewed' OR (match(properties.variant_id,'${uuid}') AND properties.quantity=1))))`;
}
export function compileBehaviorArchive(scope: DatasetScope): string {
  return nativeProjection(
    scope,
    "timestamp >= {data_interval_start} - INTERVAL 2 DAY AND timestamp < {data_interval_end}",
  );
}

// Endpoint SQL uses a fixed query shape. Provision this for the activated dataset and
// re-version if its storage cutoff changes. Request variables remain scalar instants.
export function compileBehaviorHistorySql(scope: DatasetScope): string {
  const start = "parseDateTime64BestEffort({variables.start_inclusive},6,'UTC')";
  const end = "parseDateTime64BestEffort({variables.end_exclusive},6,'UTC')";
  const cutoff = scope.behaviorArchiveCutoff;
  const bound = cutoff
    ? `parseDateTime64BestEffort('${datasetScopeSchema.parse(scope).behaviorArchiveCutoff}',6,'UTC')`
    : null;
  const recent = nativeProjection(
    scope,
    `timestamp >= ${start} AND timestamp < ${end}` +
      (bound ? ` AND timestamp >= ${bound}` : ""),
  );
  const archive = bound
    ? ` UNION ALL SELECT ${columns.join(",")} FROM analytics_behavior_export
 WHERE dataset_id='${scope.datasetId}' AND occurred_at >= ${start} AND occurred_at < ${end} AND occurred_at < ${bound}`
    : "";
  return `SELECT ${columns.join(",")} FROM (SELECT *,row_number() OVER (PARTITION BY dataset_id,event_uuid ORDER BY occurred_at) AS observation_rank FROM (${recent}${archive})) WHERE observation_rank=1`;
}
export function behaviorReportAvailability(
  scope: DatasetScope,
  requested: HistoryInterval,
  evidence: HistoryEvidence,
) {
  const gaps = behaviorHistoryCoverage(
    requested,
    scope.behaviorArchiveCutoff,
    evidence.archive,
    evidence.native,
  );
  return gaps.length
    ? { available: false as const, gaps }
    : { available: true as const, gaps };
}
