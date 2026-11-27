import { renderToStaticMarkup } from "react-dom/server";
import { AnalyticsPageClient } from "../../../Source/Features/Dashboard/AnalyticsPageClient";
import { ProductDemand } from "../../../Source/Features/Dashboard/reports/ProductReportSections";
import {
  changeDashboardLocation,
  readDashboardLocation,
  reportParams,
  type DashboardLocation,
} from "../../../Source/Features/Dashboard/request-state";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { makeAudienceFixture } from "../Reporting/audience-fixture";
import { line, request } from "../Reporting/commerce-fixture";

jest.mock("server-only", () => ({}), { virtual: true });

test.each(["customers", "products"])(
  "%s can select a long range when grouping is hidden",
  (report) => {
    const now = new Date("2026-11-26T02:00:00Z");
    const initial = readDashboardLocation(
      new URLSearchParams(`report=${report}&from=2026-11-10&to=2026-11-12&bucket=day`),
      now,
    );
    const range = {
      from: "2018-01-01",
      to: "2026-11-12",
      timezone: "America/New_York" as const,
    };
    const selection = changeDashboardLocation(initial, { range }, now);
    expect(selection.request.bucket).toBe("month");
    expect(readDashboardLocation(reportParams(selection, true), now)).toEqual(selection);
    expect(() =>
      readDashboardLocation(
        new URLSearchParams(`report=${report}&from=2018-01-01&to=2026-11-12&bucket=day`),
        now,
      ),
    ).toThrow(/bucket limit/);
  },
);

test("Customer cards distinguish buyer history, selected spend, and tracked visitors", async () => {
  const f = makeAudienceFixture();
  f.event(1, "public_page_viewed");
  f.event(2, "public_page_viewed", 60, f.sid(1));
  f.sale("prior", "returning", "2026-06-09T16:00:00.000Z");
  f.sale("returning", "returning");
  f.sale("new", "new");
  const req = { ...request("customers", "compare=true"), report: "customers" as const };
  const report = await getReport(req, f.deps);
  expect(report.data).toMatchObject({
    newBuyers: 1,
    returningBuyers: 1,
    visitors: 1,
    sessions: 2,
  });
  expect(report.data?.cohorts).toMatchObject([{ buyers: 1 }]);
  const html = renderToStaticMarkup(
    <AnalyticsPageClient
      initialRequest={{ request: req, attribution: "purchase-session" }}
      initialReport={report}
    />,
  );
  expect(html).toMatch(/aria-label="New buyers"[^]*?analytics-metric-value">1</);
  expect(html).toMatch(/aria-label="Returning buyers"[^]*?analytics-metric-value">1</);
  expect(html).toMatch(/aria-label="Tracked visitors"[^]*?analytics-metric-value">1</);
  expect(html).toMatch(
    /aria-label="Selected-period spend"[^]*?analytics-metric-value">\$86,400.00</,
  );
  expect(html).toMatch(
    /aria-label="Observed lifetime spend"[^]*?analytics-metric-value">\$129,600.00</,
  );
  expect(html).toContain('aria-label="Not elapsed">—');
  expect(html).toContain("Previous period attribution");
  expect(html).toContain("0 of 2 attributed · 2 unattributed");
  expect(html).toContain("0 of 1 attributed · 1 unattributed");
  if (!report.data?.comparison) throw new Error("Missing previous buyer period");
  report.data.comparison.attribution = null;
  const partial = renderToStaticMarkup(
    <AnalyticsPageClient
      initialRequest={{ request: req, attribution: "purchase-session" }}
      initialReport={report}
    />,
  );
  expect(partial).toMatch(
    /Previous period attribution[^]*?Attribution coverage unavailable/,
  );
  expect(partial).toContain("Previous period · $43,200.00");
});

test("Returning-buyer URL scope changes commerce while retaining observed sessions", async () => {
  const f = makeAudienceFixture();
  f.event(1, "public_page_viewed");
  f.event(2, "public_page_viewed", 60, f.sid(1));
  f.sale("prior", "returning", "2026-06-09T16:00:00.000Z");
  f.sale("current", "returning");
  f.sale("new", "new");
  const initial = readDashboardLocation(
    new URLSearchParams("report=customers&from=2026-06-10&to=2026-06-10"),
    f.deps.now,
  );
  const returning = changeDashboardLocation(
    initial,
    { customer: "returning", status: "paid", paymentMethod: "card", fulfillment: "ship" },
    f.deps.now,
  );
  const reopened = readDashboardLocation(reportParams(returning, true), f.deps.now);
  expect(reopened).toEqual(returning);
  const report = await getReport({ ...reopened.request, report: "customers" }, f.deps);
  expect(report.data).toMatchObject({
    buyers: 1,
    newBuyers: 0,
    returningBuyers: 1,
    sessions: 2,
    selectedPeriodSpend: { cents: 4320000 },
    observedLifetimeSpend: { cents: 8640000 },
  });
  expect(report.coverage).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        filter: "customer",
        metric: "traffic",
        code: "inapplicable-filter",
      }),
    ]),
  );
  const html = renderToStaticMarkup(
    <AnalyticsPageClient initialRequest={reopened} initialReport={report} />,
  );
  expect(html).toContain(">Buyer type</label>");
  expect(html).toContain(">Order status</label>");
  expect(html).toContain(">Payment method</label>");
  expect(html).toContain(">Fulfillment</label>");
  expect(html).toContain('value="returning" selected');
  const cleared = changeDashboardLocation(reopened, { customer: undefined }, f.deps.now);
  expect(reportParams(cleared).has("customer")).toBe(false);
  expect(reportParams(cleared).get("status")).toBe("paid");
});

test("Acquisition uses the selected view and retains missing attribution as its own row", async () => {
  const f = makeAudienceFixture();
  f.journey();
  f.sale("unlinked", "guest");
  const req = { ...request("acquisition"), report: "acquisition" as const };
  const report = await getReport(req, f.deps);
  const html = (attribution: DashboardLocation["attribution"]) =>
    renderToStaticMarkup(
      <AnalyticsPageClient
        initialRequest={{ request: req, attribution }}
        initialReport={report}
      />,
    );
  expect(html("purchase-session")).toContain('<th scope="row">Google</th>');
  expect(html("discovery")).toContain('<th scope="row">Instagram</th>');
  expect(html("discovery")).toContain('<th scope="row">Unattributed</th>');
  expect(html("discovery")).toContain(">Payment method</label>");
  expect(html("discovery")).toContain(">Fulfillment</label>");
});

test("Products presents purchase snapshots without a current catalog match", async () => {
  const f = makeAudienceFixture();
  f.sale("order", "buyer");
  f.put(
    "line",
    "original",
    {
      ...line,
      productId: f.pid,
      variantId: f.vid,
      productName: "Retired High Top",
      brandId: f.pid,
      brandLabel: "Original Brand",
      sizeId: f.vid,
      sizeLabel: "US 11",
    },
    { order: "order" },
  );
  f.put(
    "inventory",
    "stock",
    { productId: f.pid, variantId: f.vid, availableUnits: 0 },
    { order: null },
  );
  f.event(1, "unavailable_size_requested");
  const req = { ...request("products"), report: "products" as const };
  const report = await getReport(req, f.deps);
  expect(report.data?.products?.rows[0]?.name).toBe("Retired High Top");
  const html = renderToStaticMarkup(
    <AnalyticsPageClient
      initialRequest={{ request: req, attribution: "purchase-session" }}
      initialReport={report}
    />,
  );
  expect(html).toContain("Retired High Top");
  expect(html).toContain("Original Brand");
  expect(html).toContain("US 11");
  expect(html).toContain("Current recorded inventory");
  expect(html).toContain("Unavailable size selections");
  expect(html).toContain("0 converted / 0 eligible viewing sessions");
  expect(html).toContain(">Buyer type</label>");
  expect(html).toContain(">Order status</label>");
});

test("Product conversion uses distinct qualifying and purchasing sessions despite repeat views and orders", async () => {
  const f = makeAudienceFixture();
  f.event(1, "product_viewed");
  f.event(1, "product_viewed", 1);
  f.event(2, "product_viewed");
  for (const [id, at] of [
    ["first", "2026-06-10T12:00:02Z"],
    ["second", "2026-06-10T12:00:03Z"],
  ]) {
    f.sale(id, "buyer", at);
    f.link(id, 1, at);
    f.put(
      "line",
      id,
      { ...line, lineId: id, productId: f.pid, variantId: f.vid },
      { order: id, at },
    );
  }
  const req = { ...request("products"), report: "products" as const };
  const report = await getReport(req, f.deps);
  expect(report.data?.products?.rows[0]).toMatchObject({
    confirmedOrders: 2,
    views: 3,
    viewToPurchase: { numerator: 1, denominator: 2, value: 0.5 },
  });
  const html = renderToStaticMarkup(
    <AnalyticsPageClient
      initialRequest={{ request: req, attribution: "purchase-session" }}
      initialReport={report}
    />,
  );
  expect(html).toContain("50%<small>1 converted / 2 eligible viewing sessions</small>");
});

test.each([false, true])(
  "A failed signals query preserves scoped rank demand with variant scope %s",
  async (variant) => {
    const f = makeAudienceFixture();
    f.event(1, "variant_selected");
    f.event(1, "unavailable_size_requested", 1);
    f.event(1, "product_added_to_cart", 2);
    f.event(1, "out_of_stock_viewed", 3);
    const req = {
      ...request("products", `productId=${f.pid}${variant ? `&variantId=${f.vid}` : ""}`),
      report: "products" as const,
    };
    const report = await getReport(req, {
      ...f.deps,
      execute: (query) =>
        query.endpoint === "sole_analytics_inventory_demand"
          ? Promise.reject(new Error("Signals failed"))
          : f.execute(query),
    });
    const data = report.data;
    const row = (variant ? data?.variants : data?.products)?.rows[0];
    expect(row).toMatchObject({
      stockoutViews: variant ? null : 1,
      variantSelections: 1,
      unavailableSizeRequests: 1,
      successfulAdditions: 1,
    });
    expect(data?.unmetDemand).toBeNull();
    expect(report.coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "signals", code: "component-unavailable" }),
      ]),
    );
    const html = renderToStaticMarkup(
      <ProductDemand selected={data!.unmetDemand} row={row} />,
    );
    expect(html).toContain("<dt>Unavailable size selections</dt><dd>1</dd>");
    expect(html).toContain("<dt>Variant selections</dt><dd>1</dd>");
    expect(html).toContain(
      `<dt>Product views with all known sizes out of stock</dt><dd>${variant ? "Unavailable" : "1"}</dd>`,
    );
  },
);

test("An empty historical Customer period still shows a verified recent visitor", async () => {
  const fixture = makeAudienceFixture();
  fixture.event(1, "public_page_viewed", 0, fixture.sid(1), "2026-07-01T03:56:00Z");
  const req = { ...request("customers"), report: "customers" as const };
  const report = await getReport(req, fixture.deps);
  expect(report).toMatchObject({
    state: "empty",
    data: { buyers: 0, activeFiveMinuteVisitors: 1 },
  });
  const html = renderToStaticMarkup(
    <AnalyticsPageClient
      initialRequest={{ request: req, attribution: "purchase-session" }}
      initialReport={report}
    />,
  );
  expect(html).toContain("No activity during the selected period.");
  expect(html).toContain(
    '<h2>Active visitors in five observed minutes</h2><p class="analytics-metric-value">1</p>',
  );
});

test("A failed Products ranking leaves independently recorded stock visible", async () => {
  const fixture = makeAudienceFixture();
  fixture.put(
    "inventory",
    "stock",
    { productId: fixture.pid, variantId: fixture.vid, availableUnits: 7 },
    { order: null },
  );
  const req = { ...request("products"), report: "products" as const };
  const report = await getReport(req, {
    ...fixture.deps,
    execute: (query) =>
      query.endpoint === "sole_analytics_products"
        ? Promise.reject(new Error("Ranked section offline"))
        : fixture.execute(query),
  });
  expect(report.data).toMatchObject({ products: null, inventory: { availableUnits: 7 } });
  const html = renderToStaticMarkup(
    <AnalyticsPageClient
      initialRequest={{ request: req, attribution: "purchase-session" }}
      initialReport={report}
    />,
  );
  expect(html).toContain("This section is unavailable.");
  expect(html).toContain("<dt>Units available across recorded variants</dt><dd>7</dd>");
  expect(html).toContain("<dt>Catalog-wide variant count</dt><dd>Unavailable</dd>");
  expect(html).not.toContain("No observed groups in this period.");
});
