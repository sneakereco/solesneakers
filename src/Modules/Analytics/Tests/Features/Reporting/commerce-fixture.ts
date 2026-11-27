import assert from "node:assert/strict";
import { TZDate } from "@date-fns/tz";
import { DatabaseSync } from "node:sqlite";
import { parseReportRequest } from "../../../Source/Features/ReportContract/filters";
import type { DatasetScope } from "../../../Source/Features/CommerceFacts/contract";
import type { CompiledQuery } from "../../../Source/Features/Reporting/query-contract";
import { financialEndpoints } from "../../../Source/Features/Reporting/queries/financial";
import { commerceHealthEndpoints } from "../../../Source/Features/Reporting/queries/commerce-health";
import { executeCommerceReport } from "../../../Source/Features/Reporting/report-service";

export const day = "2026-06-10T12:00:00.000Z";
export const older = "2026-05-01T12:00:00.000Z";
export const scope: DatasetScope = {
  datasetId: "sole-staging",
  environment: "staging",
  activatedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: 2,
  financialSource: "warehouse",
  behaviorArchiveCutoff: null,
};
export const request = (report: string, extra = "") =>
  parseReportRequest(
    new URLSearchParams(`report=${report}&from=2026-06-10&to=2026-06-10&${extra}`),
    new Date("2026-07-01"),
  );
export const sale = {
  grossMerchandiseCents: 4800000,
  discountCents: 480000,
  merchandiseCents: 4320000,
  shippingCents: 180000,
  taxCents: 330000,
  totalCollectedCents: 4830000,
  paymentMethod: "card",
  fulfillment: "ship",
  status: "paid",
};
export const refund = {
  refundId: "r",
  status: "completed",
  totalCents: 97800,
  merchandiseCents: 90000,
  shippingCents: 7500,
  taxCents: 300,
  unallocatedCents: 0,
};
export const line = {
  lineId: "l",
  productId: "deleted-product",
  quantity: 3,
  merchandiseCents: 4320000,
  unitCostCents: 100000,
};
export function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE analytics_financial_export(dataset_id,environment,fact_id,revision,kind,effective_at,recorded_at,currency,order_id,buyer_key,payload,updated_at); CREATE TABLE analytics_purchase_link_export(dataset_id,order_id,active,device,purchase_session,updated_at); CREATE VIEW postgres_analytics_financial_export AS SELECT * FROM analytics_financial_export; CREATE VIEW postgres_analytics_purchase_link_export AS SELECT * FROM analytics_purchase_link_export;",
  );
  db.function("JSONExtractRaw", (raw, k) =>
    JSON.stringify(JSON.parse(String(raw ?? "{}"))[String(k)] ?? null),
  );
  db.function(
    "JSONExtractString",
    (raw, k) => JSON.parse(String(raw ?? "{}"))[String(k)] ?? "",
  );
  db.function("toInt64OrNull", (v) =>
    v === null || !/^-?\d+$/.test(String(v)) ? null : Number(v),
  );
  db.function("accurateCastOrNull", (v, type) => {
    if (type !== "Decimal128(0)") throw new Error(`Unexpected fixture cast: ${type}`);
    return v;
  });
  db.function("toString", (v) => (v === null ? null : String(v)));
  db.function("parseDateTime64BestEffortOrNull", (v, _precision, _zone) => v || null);
  db.function("dateDiff", (_unit, a, b) =>
    a && b ? Math.floor((Date.parse(String(b)) - Date.parse(String(a))) / 1000) : null,
  );
  db.function("formatDateTime", (v, _format, zone) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: String(zone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(String(v))),
  );
  db.function("toStartOfWeek", (v, _mode, zone) => {
    const d = new TZDate(String(v), String(zone));
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return new Date(d.getTime()).toISOString();
  });
  db.function("toTimeZone", (v, _zone) => v);
  db.function("toStartOfMonth", (v) => {
    const d = new TZDate(String(v), "America/New_York");
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return new Date(d.getTime()).toISOString();
  });
  const endpoints = [...financialEndpoints, ...commerceHealthEndpoints];
  return {
    db,
    put(
      kind: string,
      id: string,
      payload: object,
      options: {
        at?: string;
        revision?: number;
        order?: string | null;
        buyer?: string | null;
        dataset?: string;
      } = {},
    ) {
      const {
        at = day,
        revision = 1,
        order = "o",
        buyer = "buyer",
        dataset = scope.datasetId,
      } = options;
      db.prepare(
        "INSERT INTO analytics_financial_export VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        dataset,
        "staging",
        kind + ":" + id,
        revision,
        kind,
        at,
        day,
        "USD",
        order,
        buyer,
        JSON.stringify(payload),
        day,
      );
    },
    link(active: number, stamp: string) {
      db.prepare("INSERT INTO analytics_purchase_link_export VALUES (?,?,?,?,?,?)").run(
        scope.datasetId,
        "o",
        active,
        active ? "mobile" : null,
        active ? '{"source":"search"}' : null,
        stamp,
      );
    },
    execute(query: CompiledQuery) {
      const endpoint = endpoints.find((e) => e.name === query.endpoint)!;
      assert.equal(query.version, endpoint.version);
      assert.deepEqual(
        Object.keys(query.variables).sort(),
        endpoint.variables.map((v) => v.code_name).sort(),
      );
      const sql = endpoint.sql.replace(/\{variables\.(\w+)\}/g, ":$1");
      const statement = db.prepare(sql);
      const rows = statement.all(query.variables as Record<string, string>);
      const columns = statement.columns().map((c) => c.name);
      return Promise.resolve({
        columns,
        results: rows.map((row) => columns.map((c) => row[c])),
        hasMore: false,
      });
    },
    async report(report: "sales" | "payments" | "health", extra = "") {
      return executeCommerceReport(request(report, extra), scope, (q) => this.execute(q));
    },
  };
}
