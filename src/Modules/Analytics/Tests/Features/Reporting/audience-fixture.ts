import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { fixture, scope, sale, day } from "./commerce-fixture";
import { compileBehaviorArchive } from "../../../Source/Features/EventDelivery/behavior-archive";
import type { CompiledQuery } from "../../../Source/Features/Reporting/query-contract";
import type { ReportingDependencies } from "../../../Source/Features/Reporting/report-service";
import { visitorEndpoints } from "../../../Source/Features/Reporting/queries/visitors";
import { acquisitionEndpoints } from "../../../Source/Features/Reporting/queries/acquisition";
import { productEndpoints } from "../../../Source/Features/Reporting/queries/products";
const sid = (n: number, at = day) => {
  const hex = Date.parse(at).toString(16).padStart(12, "0");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8) +
    "-7000-8000-" +
    n.toString(16).padStart(12, "0")
  );
};
export function makeAudienceFixture(
  cutoff: string | null = null,
  activatedAt = scope.activatedAt,
) {
  const dataset = { ...scope, activatedAt, behaviorArchiveCutoff: cutoff };
  const f = fixture();
  const db = f.db;
  db.exec(
    "alter table analytics_purchase_link_export add column visitor_id; alter table analytics_purchase_link_export add column session_id; alter table analytics_purchase_link_export add column discovery; create table person_distinct_ids(distinct_id,person_id); create table events(uuid,event,timestamp,distinct_id,properties);",
  );
  const regexes = new Map<string, RegExp>();
  const dates = new Map<string, Intl.DateTimeFormat>();
  const providerFunctions: Record<string, (...v: SQLOutputValue[]) => SQLInputValue> = {
    toUUID: (v) => v,
    UUIDv7ToDateTime: (v) =>
      new Date(parseInt(String(v).replaceAll("-", "").slice(0, 12), 16)).toISOString(),
    parseDateTime64BestEffort: (v) => v,
    toInt: (v) => (v === null ? null : Number(v)),
    regexMatch: (v, p) => {
      const pattern = String(p);
      if (!regexes.has(pattern)) regexes.set(pattern, new RegExp(pattern));
      return v && regexes.get(pattern)!.test(String(v)) ? 1 : 0;
    },
    concat: (...v) => v.join(""),
    addHours: (v, h) =>
      new Date(Date.parse(String(v)) + Number(h) * 3600000).toISOString(),
  };
  for (const [name, fn] of Object.entries(providerFunctions))
    db.function(name, { varargs: true, deterministic: true }, fn);
  db.function("formatDateTime", (v, format, zone) => {
    const key = String(zone);
    if (!dates.has(key))
      dates.set(
        key,
        new Intl.DateTimeFormat("en-CA", {
          timeZone: key,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
      );
    return dates
      .get(key)!
      .format(new Date(String(v)))
      .slice(0, format === "%Y-%m" ? 7 : 10);
  });
  db.function("dateDiff", (unit, a, b) =>
    unit === "month"
      ? (new Date(String(b)).getUTCFullYear() - new Date(String(a)).getUTCFullYear()) *
          12 +
        new Date(String(b)).getUTCMonth() -
        new Date(String(a)).getUTCMonth()
      : Math.floor((Date.parse(String(b)) - Date.parse(String(a))) / 1000),
  );
  const fields = [
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
    ...["discovery", "session"].flatMap((p) =>
      ["source", "channel", "campaign", "placement"].map((d) => p + "_" + d),
    ),
    "result_count",
    "concept_kind",
    "concept_id",
  ];
  db.exec("create table analytics_behavior_export(" + fields.join(",") + ")");
  const defs = [
    ...visitorEndpoints(dataset),
    ...acquisitionEndpoints(dataset),
    ...productEndpoints(dataset),
  ];
  const sqliteSql = (sql: string) =>
    sql
      .replace(/\bmatch\(/g, "regexMatch(")
      .replace(/\{variables\.(\w+)\}/g, ":$1")
      .replace(
        /properties\.(\$?[\w]+)/g,
        (_m, k) => "json_extract(properties,'$." + k + "')",
      );
  const execute = async (query: CompiledQuery) => {
    const def = defs.find((e) => e.name === query.endpoint);
    if (!def) return f.execute(query);
    const sql = sqliteSql(def.sql);
    const st = db.prepare(sql);
    const rs = st.all(query.variables as Record<string, string>);
    const columns = st.columns().map((c) => c.name);
    return { columns, results: rs.map((r) => columns.map((c) => r[c])), hasMore: false };
  };
  const deps: ReportingDependencies = {
    dataset,
    now: new Date("2026-07-01T04:01:00Z"),
    history: {
      archive: cutoff ? [{ start: activatedAt, end: cutoff }] : [],
      native: [{ start: cutoff ?? activatedAt, end: "2026-08-01T00:00:00Z" }],
      observation: {
        sourceFreshThrough: "2026-07-01T04:00:00Z",
        observedAt: "2026-07-01T04:00:00Z",
      },
    },
    execute,
  };
  const pid = "11111111-1111-4111-8111-111111111111",
    vid = "22222222-2222-4222-8222-222222222222";
  let sequence = 0;
  function event(
    n: number,
    eventName: string,
    seconds = 0,
    visitor = sid(n),
    start = day,
  ) {
    const time = new Date(Date.parse(start) + seconds * 1000).toISOString();
    db.prepare("insert into events values (?,?,?,?,?)").run(
      sid(++sequence),
      eventName,
      time,
      visitor,
      JSON.stringify({
        environment: "staging",
        storefront: "sole",
        schema_version: 2,
        $session_id: sid(n, start),
        pathname:
          eventName === "checkout_started"
            ? "/checkout"
            : eventName === "public_page_viewed"
              ? "/"
              : "/store/" + pid,
        device: "mobile",
        product_id: pid,
        variant_id: vid,
        quantity: 1,
        discovery_source: "instagram",
        session_source: "google",
      }),
    );
  }
  function putSale(order: string, buyer: string, at = day) {
    f.put("order", order, sale, { order, buyer, at });
  }
  function link(order: string, n: number, at = day, visitor = sid(n)) {
    db.prepare(
      "insert into analytics_purchase_link_export values (?,?,?,?,?,?,?,?,?)",
    ).run(
      scope.datasetId,
      order,
      1,
      "mobile",
      '{"source":"google"}',
      at,
      visitor,
      sid(n),
      '{"source":"instagram"}',
    );
  }
  return {
    ...f,
    execute,
    deps,
    event,
    sid,
    archive(n: number, at: string, visitor: string) {
      const cols =
        "dataset_id,event_uuid,event_name,occurred_at,visitor_id,session_id,pathname,device";
      db.prepare(
        "insert into analytics_behavior_export(" + cols + ") values(?,?,?,?,?,?,?,?)",
      ).run(
        scope.datasetId,
        sid(n, at),
        "public_page_viewed",
        at,
        visitor,
        sid(n, at),
        "/",
        "mobile",
      );
    },
    sale: putSale,
    link,
    pid,
    vid,
    populateArchivedSessions(n: number) {
      const put = db.prepare(
        "insert into analytics_behavior_export(dataset_id,event_uuid,event_name,occurred_at,visitor_id,session_id,pathname,device) values(?,?,'public_page_viewed',?,?,?,'/','mobile')",
      );
      db.exec("begin");
      for (let i = 1; i <= n; i++) {
        const id = sid(i);
        put.run(dataset.datasetId, id, day, id, id);
      }
      db.exec("commit");
    },
    archiveNativeJourney() {
      const projection = sqliteSql(compileBehaviorArchive(dataset))
        .replace("{data_interval_start} - INTERVAL 2 DAY", ":lower")
        .replace("{data_interval_end}", ":upper");
      db.prepare(
        "insert into analytics_behavior_export(" +
          fields.join(",") +
          ") select " +
          fields.join(",") +
          " from (" +
          projection +
          ")",
      ).run({ lower: "2026-06-01T00:00:00Z", upper: "2026-06-12T00:00:00Z" });
    },
    journey() {
      const buyer = "sole-buyer:v1:" + "a".repeat(64);
      db.prepare("insert into person_distinct_ids values (?,?),(?,?)").run(
        sid(1),
        "native",
        buyer,
        "native",
      );
      event(1, "public_page_viewed");
      event(1, "product_viewed", 1);
      event(1, "product_added_to_cart", 2, buyer);
      event(1, "checkout_started", 3, buyer);
      event(2, "product_added_to_cart", 0, buyer);
      event(2, "product_viewed", 1, buyer);
      event(2, "checkout_started", 2, buyer);
      event(3, "product_viewed", 120, buyer, "2026-06-10T03:59:00.000Z");
      const at = new Date(Date.parse(day) + 4000).toISOString();
      putSale("ordered", buyer, at);
      link("ordered", 1, at);
    },
  };
}
