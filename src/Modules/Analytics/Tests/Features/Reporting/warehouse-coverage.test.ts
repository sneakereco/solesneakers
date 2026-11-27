import { exportAnalyticsCsv } from "../../../Source/Features/Reporting/csv-export";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { makeAudienceFixture } from "./audience-fixture";
import { request, sale } from "./commerce-fixture";

test.each(["sales", "payments"] as const)(
  "%s distinguishes a successful empty first-sync response from a verified empty period",
  async (report) => {
    const f = makeAudienceFixture();
    const req = { ...request(report), report };
    const result = await getReport(req, {
      ...f.deps,
      history: { ...f.deps.history, observation: null },
    });
    expect(result).toMatchObject({
      ingestionAsOf: null,
      data: null,
      state: "unavailable",
      coverage: expect.arrayContaining([
        expect.objectContaining({ code: "unverified-ingestion" }),
      ]),
    });
    const verified = await getReport(req, f.deps);
    expect(verified.state).toBe("empty");
    if (report === "sales")
      expect(verified.data).toMatchObject({
        confirmedOrders: 0,
        netMerchandise: { cents: 0, complete: true },
      });
  },
);

test("retains independently verified Overview activity while financial metrics stay unknown", async () => {
  const f = makeAudienceFixture();
  f.event(1, "public_page_viewed");
  const r = { ...request("overview", "compare=true"), report: "overview" as const };
  const report = await getReport(r, {
    ...f.deps,
    history: { ...f.deps.history, observation: null },
  });
  expect(report).toMatchObject({
    state: "stale",
    data: {
      summary: {
        sessions: 1,
        visitors: 1,
        confirmedOrders: null,
        netMerchandise: { cents: null, complete: false },
        conversion: { numerator: null, denominator: 1, value: null },
      },
      series: [
        expect.objectContaining({
          sessions: 1,
          confirmedOrders: null,
          netMerchandise: expect.objectContaining({ cents: null, complete: false }),
        }),
      ],
    },
  });
  expect(report.data?.comparison?.confirmedOrders).toBeNull();
  const { body } = exportAnalyticsCsv(report, r);
  expect(body).toContain('"report.data.summary.confirmedOrders","","unavailable"');
  expect(body).toContain('"report.data.summary.sessions","1","observed"');
});

test("preserves nonempty observed warehouse amounts with incomplete coverage", async () => {
  const f = makeAudienceFixture();
  f.sale("known-order", "buyer");
  const report = await getReport(
    { ...request("sales", "compare=true"), report: "sales" },
    { ...f.deps, history: { ...f.deps.history, observation: null } },
  );
  expect(report).toMatchObject({
    state: "stale",
    data: {
      confirmedOrders: 1,
      netMerchandise: { cents: sale.merchandiseCents, complete: false },
      comparison: null,
    },
  });
});

test("retains an independently observed usable checkout count without asserting a zero completion rate", async () => {
  const f = makeAudienceFixture();
  f.event(1, "checkout_started");
  const report = await getReport(
    { ...request("health"), report: "health" },
    { ...f.deps, history: { ...f.deps.history, observation: null } },
  );
  expect(report).toMatchObject({
    state: "stale",
    data: {
      checkoutCompletion: { numerator: null, denominator: 1, value: null },
      fulfillmentPreference: null,
      outcomes: null,
    },
  });
  expect(report.data?.funnel[0].sessions).toBe(1);
  expect(report.data?.funnel[4].sessions).toBeNull();
});

test.each(["overview", "customers", "acquisition", "products", "health"] as const)(
  "%s does not claim no activity when both warehouse and behavioral evidence are missing",
  async (report) => {
    const f = makeAudienceFixture();
    const result = await getReport(
      { ...request(report), report },
      { ...f.deps, history: { archive: [], native: [], observation: null } },
    );
    expect(result).toMatchObject({ state: "unavailable", data: null });
  },
);

test("keeps independently verified acquisition traffic and product demand without zero sales", async () => {
  const f = makeAudienceFixture();
  f.event(1, "product_viewed");
  const deps = { ...f.deps, history: { ...f.deps.history, observation: null } };
  const acquisition = await getReport(
    { ...request("acquisition"), report: "acquisition" },
    deps,
  );
  expect(acquisition.data?.purchaseSession).toMatchObject({
    attribution: null,
    sources: {
      rows: [
        {
          sessions: 1,
          purchasingSessions: null,
          confirmedOrders: null,
          revenue: { cents: null, complete: false },
        },
      ],
    },
  });

  const products = await getReport({ ...request("products"), report: "products" }, deps);
  expect(products.data).toMatchObject({
    attribution: null,
    inventory: null,
    products: {
      rows: [
        {
          views: 1,
          confirmedOrders: null,
          netMerchandise: { cents: null, complete: false },
          viewToPurchase: { numerator: null, denominator: 1, value: null },
        },
      ],
    },
  });
});
