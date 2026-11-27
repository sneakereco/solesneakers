import { parseReportRequest } from "../../../Source/Features/ReportContract/filters";
import { request, older, day } from "./commerce-fixture";
import * as service from "../../../Source/Features/Reporting/report-service";
import { makeAudienceFixture } from "./audience-fixture";

it("counts purchasing sessions once independently of order and buyer authority", async () => {
  const f = makeAudienceFixture("2026-06-12T00:00:00.000Z");
  f.populateArchivedSessions(12000);
  for (let i = 0; i < 239; i++) {
    f.sale("order" + i, "buyer" + i);
    f.link("order" + i, (i % 228) + 1);
  }
  f.sale("unlinked", "guest");
  const r = await service.getReport(
    { ...request("overview"), report: "overview" },
    f.deps,
  );
  expect(r.data?.summary).toMatchObject({
    confirmedOrders: 240,
    buyers: 240,
    sessions: 12000,
    conversion: { numerator: 228, denominator: 12000, value: 0.019 },
  });
  expect(r.data?.funnel[4].sessions).toBe(0);
});
it("uses native identity merge, ordered events and entry boundaries", async () => {
  const f = makeAudienceFixture();
  f.journey();
  const r = await service.getReport({ ...request("health"), report: "health" }, f.deps);
  expect(r.data?.funnel.map((s) => s.sessions)).toEqual([2, 2, 1, 1, 1]);
  const customers = await service.getReport(
    { ...request("customers"), report: "customers" },
    f.deps,
  );
  expect(customers.data).toMatchObject({
    visitors: 1,
    sessions: 2,
    activeFiveMinuteVisitors: 0,
  });
});
it("groups since-activation buyers and leaves future retention months unavailable", async () => {
  const f = makeAudienceFixture();
  f.sale("old", "repeat", older);
  f.sale("again", "repeat");
  f.sale("first", "new");
  f.sale("legacy", "new", "2025-12-01T00:00:00.000Z");
  f.sale("later", "new", "2026-07-01T03:00:00.000Z");
  const r = await service.getReport(
    { ...request("customers"), report: "customers" },
    f.deps,
  );
  expect(r.data).toMatchObject({
    buyers: 2,
    newBuyers: 1,
    returningBuyers: 1,
    selectedPeriodSpend: { cents: 8640000 },
    observedLifetimeSpend: { cents: 17280000 },
  });
  expect(r.data?.cohorts?.[0].repeatPurchases[1].repeatPurchaseRate.value).toBeNull();
});
it("resolves surviving archive observations through the same current provider identity over 24 months", async () => {
  const start = "2024-07-01T12:00:00.000Z",
    cutoff = "2025-07-01T00:00:00.000Z",
    f = makeAudienceFixture(cutoff, "2024-06-01T00:00:00.000Z"),
    buyer = "sole-buyer:v1:" + "f".repeat(64);
  f.deps.history = {
    ...f.deps.history,
    archive: [{ start: "2024-07-01T04:00:00Z", end: cutoff }],
    native: [{ start: cutoff, end: "2026-07-02T00:00:00Z" }],
  };
  f.archive(41, start, f.sid(41, start));
  f.event(42, "public_page_viewed", 0, buyer);
  f.db
    .prepare("insert into person_distinct_ids values (?,?),(?,?)")
    .run(f.sid(41, start), "merged", buyer, "merged");
  const req = parseReportRequest(
    new URLSearchParams("report=customers&from=2024-07-01&to=2026-06-30"),
    f.deps.now,
  );
  const r = await service.getReport({ ...req, report: "customers" }, f.deps);
  expect(r.data).toMatchObject({ visitors: 1, sessions: 2 });
  f.deps.history.archive = [];
  const gap = await service.getReport({ ...req, report: "customers" }, f.deps);
  expect(gap.data?.sessions).toBeNull();
});
it("retains verified overview financials on a failed optional visitor query", async () => {
  const f = makeAudienceFixture();
  f.sale("guest", "guest");
  const r = await service.getReport(
    { ...request("overview"), report: "overview" },
    {
      ...f.deps,
      execute: (q) =>
        q.endpoint === "sole_analytics_sessions"
          ? Promise.reject(new Error("provider unavailable"))
          : f.deps.execute(q),
    },
  );
  expect(r.data?.summary).toMatchObject({ confirmedOrders: 1, sessions: null });
  expect(r.coverage.some((c) => c.metric === "sessions")).toBe(true);
});
it("compares buyers in the preceding calendar period using the same lifetime observation date", async () => {
  const f = makeAudienceFixture();
  f.sale("prev", "a", "2026-06-09T16:00:00.000Z");
  f.sale("today", "a");
  f.sale("today-new", "b");
  const r = await service.getReport(
    { ...request("customers", "compare=true"), report: "customers" },
    f.deps,
  );
  expect(r.data?.comparison).toMatchObject({
    buyers: 1,
    newBuyers: 1,
    observedLifetimeSpend: { cents: 8640000 },
  });
  expect(r.data?.comparison).not.toHaveProperty("activeFiveMinuteVisitors");
});
it("bounds current behavior and purchasing conversion to a verified prefix while preserving full financials", async () => {
  const f = makeAudienceFixture(),
    stop = new Date(Date.parse(day) + 5000),
    now = new Date(Date.parse(day) + 120000);
  f.event(1, "public_page_viewed");
  f.event(2, "public_page_viewed", 0, f.sid(2), "2026-06-10T12:01:00.000Z");
  f.sale("late", "guest", "2026-06-10T12:01:30.000Z");
  f.link("late", 1);
  const deps = {
    ...f.deps,
    now,
    history: {
      archive: [],
      native: [{ start: f.deps.dataset!.activatedAt, end: stop.toISOString() }],
      observation: null,
    },
  };
  const req = parseReportRequest(
    new URLSearchParams("report=overview&from=2026-06-10&to=2026-06-10"),
    now,
  );
  const r = await service.getReport({ ...req, report: "overview" }, deps);
  expect(r.behaviorThrough).toBe(stop.toISOString());
  expect(r.data?.summary).toMatchObject({
    sessions: 1,
    confirmedOrders: 1,
    conversion: { numerator: 0, denominator: 1 },
  });
  const c = await service.getReport({ ...req, report: "customers" }, deps);
  expect(c.data?.activeFiveMinuteVisitors).toBe(1);
  expect(c.data?.activeWindow?.end).toBe(stop.toISOString());
  const stale = await service.getReport(
    { ...req, report: "customers" },
    { ...deps, now: new Date(stop.getTime() + 300001) },
  );
  expect(stale.data?.activeFiveMinuteVisitors).toBeNull();
});
it("reports a holed recent native interval and excludes invalid session times", async () => {
  const f = makeAudienceFixture();
  f.event(1, "public_page_viewed");
  f.db.exec(
    "update events set properties=json_set(properties,'$.$session_id','11111111-1111-4111-8111-111111111111')",
  );
  const r = await service.getReport(
    { ...request("customers"), report: "customers" },
    {
      ...f.deps,
      history: {
        ...f.deps.history,
        native: [
          { start: "2026-06-01T00:00:00Z", end: "2026-07-01T03:57:00Z" },
          { start: "2026-07-01T03:59:00Z", end: "2026-07-01T04:01:00Z" },
        ],
      },
    },
  );
  expect(r.data).toMatchObject({
    sessions: 0,
    activeWindow: null,
    activeFiveMinuteVisitors: null,
  });
  expect(r.coverage).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ metric: "sessions", missingCount: 1 }),
    ]),
  );
});
it("honors a latest revocation and keeps a fresh anonymous session distinct", async () => {
  const f = makeAudienceFixture();
  f.journey();
  f.event(5, "public_page_viewed");
  f.db
    .prepare(
      "insert into analytics_purchase_link_export(dataset_id,order_id,active,updated_at) values(?,?,0,?)",
    )
    .run(f.deps.dataset!.datasetId, "ordered", "2026-06-11T00:00:00Z");
  const r = await service.getReport(
    { ...request("overview"), report: "overview" },
    f.deps,
  );
  expect(r.data?.summary).toMatchObject({
    buyers: 1,
    confirmedOrders: 1,
    visitors: 2,
    sessions: 3,
    conversion: { numerator: 0, denominator: 3 },
  });
});
it("preserves the same journey across native measurement and the actual minimized archive projection", async () => {
  const native = makeAudienceFixture(),
    archive = makeAudienceFixture("2026-06-12T00:00:00.000Z");
  native.journey();
  archive.journey();
  archive.archiveNativeJourney();
  const req = { ...request("overview"), report: "overview" as const };
  const [a, b] = await Promise.all([
    service.getReport(req, native.deps),
    service.getReport(req, archive.deps),
  ]);
  expect(a.data?.summary).toMatchObject({ sessions: 2, visitors: 1, confirmedOrders: 1 });
  expect(b.data).toEqual(a.data);
});
it("keeps verified live activity for a calendar selection wholly before activation", async () => {
  const f = makeAudienceFixture();
  f.event(1, "public_page_viewed", 0, f.sid(1), "2026-07-01T04:00:00.000Z");
  const calendar = parseReportRequest(
    new URLSearchParams("from=2025-06-01&to=2025-06-01&report=customers"),
    f.deps.now,
  );
  const calls: string[] = [];
  const result = await service.getReport(
    { ...calendar, report: "customers" },
    {
      ...f.deps,
      execute: (q) => {
        calls.push(q.endpoint);
        return f.deps.execute(q);
      },
    },
  );
  expect(result.data).toMatchObject({
    buyers: null,
    sessions: null,
    cohorts: null,
    attribution: null,
    missingBuyerOrders: null,
    observedLifetimeSpend: { cents: null },
    activeFiveMinuteVisitors: 1,
    activeWindow: { end: f.deps.now.toISOString() },
  });
  expect(result.coverage.some((c) => c.code === "before-dataset-start")).toBe(true);
  expect(calls).toEqual(["sole_analytics_active"]);
});
it("keeps buyer evidence when behavioral history has a hole", async () => {
  const f = makeAudienceFixture();
  f.sale("unlinked", "guest");
  const r = await service.getReport(
    { ...request("customers"), report: "customers" },
    { ...f.deps, history: { native: [], archive: [], observation: null } },
  );
  expect(r.data).toMatchObject({ buyers: 1, sessions: null, visitors: null });
  expect(r.coverage.some((c) => c.code === "incomplete-coverage")).toBe(true);
});
it("review: isolates a failed cohort result from independent buyer and visitor data", async () => {
  const f = makeAudienceFixture();
  f.journey();
  const req = { ...request("customers"), report: "customers" as const };
  for (const malformed of [false, true, null]) {
    const r = await service.getReport(req, {
      ...f.deps,
      execute: (q) => {
        if (q.endpoint === "sole_analytics_customer_cohorts") {
          if (malformed !== false) return Promise.resolve(malformed ? {} : null);
          throw Error("private failure");
        }
        return f.deps.execute(q);
      },
    });
    expect(r.data).toMatchObject({ buyers: 1, sessions: 2, cohorts: null });
    expect(r.coverage.some((c) => c.metric === "cohorts")).toBe(true);
  }
});
it("review: preserves native-only recent activity on an events-backed canonical dataset", async () => {
  const f = makeAudienceFixture();
  const calls: string[] = [];
  f.event(1, "public_page_viewed", 0, f.sid(1), "2026-07-01T04:00:00.000Z");
  const req = parseReportRequest(
    new URLSearchParams("from=2025-06-01&to=2025-06-01&report=customers"),
    f.deps.now,
  );
  const deps = {
    ...f.deps,
    dataset: { ...f.deps.dataset!, financialSource: "events" as const },
    execute: (q: Parameters<typeof f.execute>[0]) => {
      calls.push(q.endpoint);
      return f.execute(q);
    },
  };
  const live = await service.getReport({ ...req, report: "customers" }, deps);
  expect(live.data).toMatchObject({
    activeFiveMinuteVisitors: 1,
    buyers: null,
    cohorts: null,
  });
  expect(calls).toEqual(["sole_analytics_active"]);
  const finance = await service.getReport({ ...request("sales"), report: "sales" }, deps);
  expect(finance.data).toBeNull();
  expect(calls).toHaveLength(1);
});
it("review: reports invalid timing independently for live, products, acquisition and preceding sessions", async () => {
  const f = makeAudienceFixture();
  for (const at of [
    "2026-06-09T12:00:00.000Z",
    "2026-06-10T12:00:00.000Z",
    "2026-07-01T04:00:00.000Z",
  ])
    f.event(1, "product_viewed", 0, f.sid(1), at);
  f.db.exec(
    "update events set properties=json_set(properties,'$.$session_id','11111111-1111-4111-8111-111111111111')",
  );
  f.sale("o", "guest");
  const req = parseReportRequest(
    new URLSearchParams("from=2025-06-01&to=2025-06-01&report=customers"),
    f.deps.now,
  );
  const live = await service.getReport({ ...req, report: "customers" }, f.deps);
  expect(live.data).toBeNull();
  expect(live.coverage).toContainEqual(
    expect.objectContaining({ metric: "activeFiveMinuteVisitors", missingCount: 1 }),
  );
  for (const [report, metric] of [
    ["products", "productBehavior"],
    ["acquisition", "purchaseSession"],
    ["overview", "sessions"],
  ] as const) {
    const r = await service.getReport(
      { ...request(report, "compare=true"), report },
      f.deps,
    );
    expect(r.data).not.toBeNull();
    expect(r.coverage).toEqual(
      expect.arrayContaining(
        [metric, "comparison." + metric].map((m) =>
          expect.objectContaining({ metric: m, missingCount: 1 }),
        ),
      ),
    );
  }
});
it("review: retains coverage from Overview leaders when the session section fails", async () => {
  const f = makeAudienceFixture();
  f.sale("order-without-lines", "guest");
  f.event(1, "product_viewed");
  f.db.exec(
    "update events set properties=json_set(properties,'$.$session_id','11111111-1111-4111-8111-111111111111')",
  );
  const r = await service.getReport(
    { ...request("overview"), report: "overview" },
    {
      ...f.deps,
      execute: (q) => {
        if (q.endpoint === "sole_analytics_sessions") throw Error("session unavailable");
        return f.execute(q);
      },
    },
  );
  expect(r.data?.summary.confirmedOrders).toBe(1);
  expect(r.coverage).toEqual(
    expect.arrayContaining(
      ["productOrders", "productBehavior", "purchaseSession"].map((metric) =>
        expect.objectContaining({ metric, missingCount: 1 }),
      ),
    ),
  );
});
