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
 row_number() OVER (PARTITION BY session_id ORDER BY occurred_at DESC,event_uuid DESC) AS last_rank
 FROM valid_events WHERE ${eligibleSessionEntry("entered_at")}
 ), session_entries AS (
 SELECT e.*,last.visitor AS session_visitor FROM session_events e
 JOIN session_events last ON last.session_id=e.session_id AND last.last_rank=1 WHERE e.entry_rank=1
 )`;
}

export function sessionSql(scope: DatasetScope) {
  return `${commerceSourceSql},${observationSql(scope)},
 sessions AS (SELECT * FROM session_entries WHERE ${devicePredicate} AND ${segmentPredicate("session")}),
 views AS (SELECT session_id AS sid,min(occurred_at) AS viewed_at FROM session_events WHERE event_name='product_viewed' GROUP BY session_id),
 adds AS (SELECT e.session_id AS sid,min(e.occurred_at) AS added_at FROM session_events e JOIN views v ON v.sid=e.session_id WHERE e.event_name='product_added_to_cart' AND e.occurred_at>=v.viewed_at GROUP BY e.session_id),
 checkouts AS (SELECT e.session_id AS sid,min(e.occurred_at) AS usable_checkout_at,
 min(CASE WHEN a.sid=e.session_id AND e.occurred_at>=a.added_at THEN e.occurred_at ELSE NULL END) AS checkout_at
 FROM session_events e LEFT JOIN adds a ON a.sid=e.session_id WHERE e.event_name='checkout_started' GROUP BY e.session_id),
 purchases AS (SELECT toString(l.session_id) AS sid,max(o.report_at) AS last_purchase FROM selected o JOIN ranked_links l
 ON o.order_id=toString(l.order_id) AND l.link_rank=1 AND l.active=1 JOIN sessions anchor ON toString(l.session_id)=toString(anchor.session_id) WHERE ${purchaseInSession("o.report_at", "anchor.entered_at")} AND o.kind='order' GROUP BY sid),
 steps AS (SELECT s.*,CASE WHEN v.sid=s.session_id THEN v.viewed_at ELSE NULL END AS viewed_at,CASE WHEN a.sid=s.session_id THEN a.added_at ELSE NULL END AS added_at,CASE WHEN c.sid=s.session_id THEN c.checkout_at ELSE NULL END AS checkout_at,
 CASE WHEN c.sid=s.session_id THEN c.usable_checkout_at ELSE NULL END AS usable_checkout_at,
 CASE WHEN p.last_purchase>=s.entered_at AND p.last_purchase<addHours(s.entered_at,24) THEN p.last_purchase ELSE NULL END AS purchase_at
 FROM sessions s LEFT JOIN views v ON s.session_id=v.sid LEFT JOIN adds a ON s.session_id=a.sid LEFT JOIN checkouts c ON s.session_id=c.sid LEFT JOIN purchases p ON s.session_id=p.sid)`;
}
