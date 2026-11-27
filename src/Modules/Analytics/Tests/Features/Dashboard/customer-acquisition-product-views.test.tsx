import { renderToStaticMarkup } from "react-dom/server";
import { AnalyticsPageClient } from "../../../Source/Features/Dashboard/AnalyticsPageClient";
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
});

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
  expect(html).not.toContain("No matching groups in this period.");
});
