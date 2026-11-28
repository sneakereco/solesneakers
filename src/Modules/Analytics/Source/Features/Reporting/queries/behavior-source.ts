import "server-only";
import type { DatasetScope } from "../../CommerceFacts/contract";
import { compileBehaviorHistorySql } from "../../EventDelivery/behavior-archive";
import {
  commerceSourceSql,
  inRange,
  instant,
  observedDimension,
} from "./commerce-source";

export const segmentPredicate = (prefix: string) =>
  ["source", "channel", "campaign"]
    .map(
      (k) =>
        "({variables." +
        k +
        "}='' OR " +
        observedDimension(prefix + "_" + k) +
        "={variables." +
        k +
        "})",
    )
    .join(" AND ");
export const devicePredicate = `({variables.device}='' OR ${observedDimension("device")}={variables.device})`;
export const sessionEntryPredicate = `${devicePredicate} AND ${segmentPredicate("session")}`;

export const validTiming =
  "substring(toString(session_id),15,1)='7' AND occurred_at>=entered_at AND occurred_at<addHours(entered_at,24)";
export const invalidTimingCount = (scopePredicate = "1=1") =>
  `(SELECT count(*) FROM observed WHERE NOT (${validTiming}) AND ${scopePredicate})`;
export const eligibleSessionEntry = (entry: string) =>
  `${inRange(entry)} AND ${entry}>=${instant("{variables.activated_at}")}`;
export const purchaseInSession = (at: string, entry: string) =>
  `${at}>=${entry} AND ${at}<addHours(${entry},24) AND ${at}<${instant("{variables.behavior_end}")}`;

// SDK sessions use UUIDv7 (creation time); the projected distinct ID is resolved at
// query time against PostHog's latest nondeleted mapping, including archived events.
export function observationSql(scope: DatasetScope) {
  return `observations AS (SELECT * FROM (${compileBehaviorHistorySql(scope)}) WHERE {variables.behavior_enabled}='yes' AND occurred_at<${instant("{variables.behavior_end}")} ),
 observed AS (
 SELECT h.*,CASE WHEN p.distinct_id=h.visitor_id THEN concat('person:',toString(p.person_id)) ELSE concat('distinct:',h.visitor_id) END AS visitor,
 UUIDv7ToDateTime(toUUID(toString(h.session_id))) AS entered_at
 FROM observations h LEFT JOIN person_distinct_ids p ON h.visitor_id=p.distinct_id
 ), valid_events AS (
 SELECT * FROM observed WHERE ${validTiming}
 ), session_events AS (
 SELECT *,row_number() OVER (PARTITION BY session_id ORDER BY occurred_at,event_uuid) AS entry_rank,
 first_value(visitor) OVER (PARTITION BY session_id ORDER BY occurred_at DESC,event_uuid DESC
 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS session_visitor
 FROM valid_events WHERE ${eligibleSessionEntry("entered_at")}
 ), session_entries AS (
 SELECT * FROM session_events WHERE entry_rank=1
 )`;
}

export function sessionSql(scope: DatasetScope) {
  return `${commerceSourceSql},${observationSql(scope)},
 session_views AS (
 SELECT *,min(CASE WHEN event_name='product_viewed' THEN occurred_at END) OVER (PARTITION BY session_id) AS viewed_at,
 min(CASE WHEN event_name='checkout_started' THEN occurred_at END) OVER (PARTITION BY session_id) AS usable_checkout_at
 FROM session_events
 ), session_adds AS (
 SELECT *,min(CASE WHEN event_name='product_added_to_cart' AND occurred_at>=viewed_at THEN occurred_at END) OVER (PARTITION BY session_id) AS added_at
 FROM session_views
 ), session_checkouts AS (
 SELECT *,min(CASE WHEN event_name='checkout_started' AND occurred_at>=added_at THEN occurred_at END) OVER (PARTITION BY session_id) AS checkout_at
 FROM session_adds
 ), sessions AS (
 SELECT session_id,session_visitor,device,entered_at,viewed_at,added_at,checkout_at,usable_checkout_at
 FROM session_checkouts WHERE entry_rank=1 AND ${sessionEntryPredicate}
 ), linked_purchases AS (
 SELECT toString(l.session_id) AS sid,o.report_at AS purchased_at FROM selected o JOIN ranked_links l
 ON o.order_id=toString(l.order_id) AND l.link_rank=1 AND l.active=1 WHERE o.kind='order'
 ), steps AS (
 SELECT s.session_id,s.session_visitor,s.device,s.viewed_at,s.added_at,s.checkout_at,s.usable_checkout_at,
 max(CASE WHEN p.sid=toString(s.session_id) AND ${purchaseInSession("p.purchased_at", "s.entered_at")} THEN p.purchased_at END) AS purchase_at
 FROM sessions s LEFT JOIN linked_purchases p ON toString(s.session_id)=p.sid
 GROUP BY s.session_id,s.session_visitor,s.device,s.viewed_at,s.added_at,s.checkout_at,s.usable_checkout_at
 )`;
}
