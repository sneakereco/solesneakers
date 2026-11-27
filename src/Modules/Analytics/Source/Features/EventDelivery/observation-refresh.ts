import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { DatasetScope } from "../CommerceFacts/contract";
import { endpoint } from "../Reporting/queries/commerce-source";
import { compileBehaviorHistorySql } from "./behavior-archive";
import { analyticsInstantMicros, parseHogqlInstant } from "./instant";
import { postHogWarehouseTables } from "./history-source";

const amount = (s: string) =>
  `if(toTypeName(${s}) in ('String','Nullable(String)','LowCardinality(String)','LowCardinality(Nullable(String))'),toString(${s}),'')`;
const instant = (s: string) => `formatDateTime(${s},'%Y-%m-%dT%H:%i:%S.%fZ','UTC')`;
const financeFields = [
  "dataset_id",
  "environment",
  "fact_id",
  "revision",
  "kind",
  "effective_at",
  "recorded_at",
  "currency",
  "order_id",
  "buyer_key",
  "payload",
  "updated_at",
];
const linkFields = [
  "dataset_id",
  "order_id",
  "active",
  "visitor_id",
  "session_id",
  "device",
  "discovery",
  "purchase_session",
  "updated_at",
];
const timeFields = new Set(["effective_at", "recorded_at", "updated_at"]);
const jsonFields = new Set(["payload", "discovery", "purchase_session"]);
const nullableTextFields = new Set([
  "currency",
  "order_id",
  "buyer_key",
  "visitor_id",
  "session_id",
  "device",
]);
function projection(table: string, fields: string[], id: string) {
  const cols = fields.map((key) => {
    const col = table + "." + key;
    const value = timeFields.has(key)
      ? instant(col)
      : jsonFields.has(key)
        ? `if(isNull(${col}),NULL,${amount(col)})`
        : col;
    return value + " AS " + key;
  });
  // The invalid-key bucket maps to the zero hash and remains in every exhaustive sweep.
  return `SELECT ${cols.join(",")},count() OVER () AS partition_rows FROM ${table}
    WHERE dataset_id={variables.dataset_id} AND startsWith(if(isNull(${id}),repeat('0',32),lower(hex(MD5(toString(${id}))))),{variables.prefix}) ORDER BY ${id} LIMIT 501`;
}
export const financeObservation = endpoint(
  "sole_analytics_observe_finance",
  projection(postHogWarehouseTables.finance, financeFields, "fact_id"),
);
export const linkObservation = endpoint(
  "sole_analytics_observe_links",
  projection(postHogWarehouseTables.purchases, linkFields, "order_id"),
);
export function nativeObservation(scope: DatasetScope) {
  const native = compileBehaviorHistorySql({ ...scope, behaviorArchiveCutoff: null });
  // PostHog marker ingestion truncates receipt timestamps to milliseconds.
  return endpoint(
    "sole_analytics_observe_native",
    `SELECT
    (SELECT count() FROM (${native})) AS visible_events,
    (SELECT countDistinct(tuple(uuid,timestamp,distinct_id)) FROM events WHERE
      event='sole_analytics_probe_v1' AND properties.dataset_id={variables.dataset_id}
      AND distinct_id='sole:availability' AND ((toString(uuid)={variables.first_id} AND dateDiff('millisecond',timestamp,${parseHogqlInstant("{variables.start_inclusive}")})=0) OR
      (toString(uuid)={variables.last_id} AND dateDiff('millisecond',timestamp,${parseHogqlInstant("{variables.end_exclusive}")})=0))) AS markers`,
  );
}

const table = z.object({
  columns: z.array(z.string()),
  results: z.array(z.array(z.unknown())),
  hasMore: z.boolean(),
  truncated: z.boolean().optional(),
});
export function checkObservation(
  source: Record<string, unknown>[],
  wire: unknown,
  kind: "finance" | "links",
) {
  const data = table.parse(wire);
  const fields = kind === "finance" ? financeFields : linkFields;
  if (!isDeepStrictEqual(data.columns, [...fields, "partition_rows"]))
    throw Error("Invalid observation columns");
  if (source.length > 500 || data.hasMore || data.truncated || data.results.length > 500)
    return "split";
  const key = kind === "finance" ? "fact_id" : "order_id";
  const expected = new Map(source.map((row) => [row[key], row]));
  if (
    expected.size !== source.length ||
    source.some((row) => typeof row[key] !== "string" || !row[key])
  )
    throw Error("Invalid source identities");
  let mismatch = false;
  for (const row of data.results) {
    if (row.length !== fields.length + 1 || row.at(-1) !== data.results.length)
      throw Error("Invalid observation row");
    const id = row[fields.indexOf(key)];
    if (typeof id !== "string" || !id) throw Error("Invalid observation identity");
    const original = expected.get(id);
    if (!original) mismatch = true;
    for (const [index, name] of fields.entries()) {
      let actual = row[index],
        wanted = original?.[name];
      if (timeFields.has(name)) {
        if (typeof actual !== "string") throw Error("Invalid observation timestamp");
        actual = analyticsInstantMicros(actual);
        if (original) {
          if (typeof wanted !== "string") throw Error("Invalid source timestamp");
          wanted = analyticsInstantMicros(wanted);
        }
      } else if (jsonFields.has(name) && actual !== null) {
        if (typeof actual !== "string" || actual.length > 8192)
          throw Error("Invalid observation JSON");
        actual = JSON.parse(actual, (_k, v, context?: { source?: string }) => {
          if (
            typeof v === "number" &&
            (!Number.isSafeInteger(v) ||
              !/^[-]?\d+(?:\.0+)?$/.test(context?.source ?? ""))
          )
            throw Error("Invalid numeric observation");
          return v;
        });
      } else if (name === "revision") {
        if (typeof actual !== "number" || !Number.isSafeInteger(actual) || actual < 1)
          throw Error("Invalid observation revision");
      } else if (name === "active") {
        if (typeof actual !== "boolean") throw Error("Invalid observation link status");
      } else if (
        typeof actual !== "string" &&
        !(actual === null && (jsonFields.has(name) || nullableTextFields.has(name)))
      ) {
        throw Error("Invalid observation text");
      }
      if (original && !isDeepStrictEqual(actual, wanted)) mismatch = true;
    }
    expected.delete(id);
  }
  return mismatch || expected.size ? "retry" : "matched";
}
