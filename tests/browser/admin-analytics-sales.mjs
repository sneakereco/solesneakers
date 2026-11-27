import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const productId = "00000000-0000-4000-a000-000000000001";
export const salesQuery = new URLSearchParams({
  report: "sales",
  from: "2026-11-10",
  to: "2026-11-12",
  compare: "true",
  page: "4",
  pageSize: "1",
  productId,
});

const money = (cents, missingCount = 0) => ({
  cents,
  complete: missingCount === 0,
  missingCount,
});
const rate = (numerator, denominator) => ({
  numerator,
  denominator,
  value: numerator / denominator,
});
const bounds = [0, 5000, 10000, 25000, 50000, 100000];
const bins = (counts) =>
  bounds.map((minimumCents, index) => ({
    minimumCents,
    maximumCentsExclusive: bounds[index + 1] ?? null,
    confirmedOrders: counts[index] ?? 0,
  }));

export function salesFixture(meta, compare) {
  // Activity includes an unallocated refund for an order before this range.
  // Cohort instead includes an allocated refund after this range for an order confirmed within it.
  const cohort = meta.scope.dateBasis === "order-cohort";
  const selected = {
    grossMerchandise: money(20_000),
    discounts: money(2000),
    merchandiseRefunds: cohort ? money(2000) : money(null, 1),
    shippingCollected: money(1000),
    shippingRefunds: cohort ? money(0) : money(null, 1),
    taxCollected: money(1400),
    taxRefunds: cohort ? money(0) : money(null, 1),
    unallocatedRefunds: money(cohort ? 0 : 1001),
    netMerchandise: cohort ? money(16_000) : money(18_000, 1),
    netShipping: cohort ? money(1000) : money(1000, 1),
    netTax: cohort ? money(1400) : money(1400, 1),
    totalCollected: money(cohort ? 18_400 : 19_399),
    buyers: { known: 2, missingOrders: 0 },
    attribution: { eligibleOrders: 2, attributedOrders: 1 },
    missingOrderValues: 0,
    missingReturnQuantities: cohort ? 0 : 1,
    confirmedOrders: 2,
    averageOrderValue: money(9000),
    medianOrderValue: money(9000),
    orderValueBins: bins([1, 0, 1]),
    units: 3,
    netUnits: cohort ? 2 : null,
    recordedCogs: money(0, cohort ? 1 : 2),
    recordedProfit: cohort ? money(12_000, 1) : money(14_000, 2),
    costCoverage: {
      revenue: rate(14_000, 18_000),
      orders: rate(1, 2),
      lines: rate(1, 2),
    },
    shippingContribution: cohort ? money(725) : money(725, 1),
    fees: money(null, 2),
  };
  const prior = {
    ...selected,
    grossMerchandise: money(12_000),
    discounts: money(0),
    merchandiseRefunds: cohort ? money(null, 1) : money(0),
    shippingCollected: money(0),
    shippingRefunds: cohort ? money(null, 1) : money(0),
    taxCollected: money(0),
    taxRefunds: cohort ? money(null, 1) : money(0),
    unallocatedRefunds: money(cohort ? 1001 : 0),
    netMerchandise: money(12_000, cohort ? 1 : 0),
    netShipping: money(0, cohort ? 1 : 0),
    netTax: money(0, cohort ? 1 : 0),
    totalCollected: money(cohort ? 10_999 : 12_000),
    buyers: { known: 1, missingOrders: 0 },
    attribution: { eligibleOrders: 1, attributedOrders: 0 },
    missingReturnQuantities: cohort ? 1 : 0,
    confirmedOrders: 1,
    averageOrderValue: money(12_000),
    medianOrderValue: money(12_000),
    orderValueBins: bins([0, 0, 1]),
    units: 1,
    netUnits: cohort ? null : 1,
    recordedCogs: money(null, cohort ? 2 : 1),
    recordedProfit: money(null, cohort ? 3 : 1),
    costCoverage: { revenue: rate(0, 12_000), orders: rate(0, 1), lines: rate(0, 1) },
    shippingContribution: money(0, cohort ? 1 : 0),
    fees: money(0),
  };
  const day = 86_400_000;
  const bucket = (period, start, offset) => ({
    startInclusive: new Date(Date.parse(start) + offset * day).toISOString(),
    endExclusive: new Date(Date.parse(start) + (offset + 1) * day).toISOString(),
    netMerchandise: period.netMerchandise,
    confirmedOrders: period.confirmedOrders,
    sessions: null,
    visitors: null,
  });
  return {
    ...meta,
    scope: {
      ...meta.scope,
      attribution: {
        ...meta.scope.attribution,
        eligibleOrders: 2,
        attributedOrders: 1,
        unattributedOrders: 1,
      },
    },
    state: "ready",
    data: {
      ...selected,
      series: [
        bucket(
          { netMerchandise: money(4000), confirmedOrders: 1 },
          meta.range.startInclusive,
          0,
        ),
        bucket(
          { netMerchandise: money(cohort ? 12_000 : 14_000), confirmedOrders: 1 },
          meta.range.startInclusive,
          1,
        ),
        bucket(
          { netMerchandise: cohort ? money(0) : money(null, 1), confirmedOrders: 0 },
          meta.range.startInclusive,
          2,
        ),
      ],
      comparison: compare ? prior : null,
      comparisonSeries: compare
        ? [bucket(prior, meta.range.comparisonStartInclusive, 0)]
        : null,
    },
  };
}

export async function runSalesScenario({ page, requests, exports, capture }) {
  const report = page.getByRole("navigation", { name: "Analytics reports" });
  assert.equal(
    await report
      .getByRole("button", { name: "Sales & revenue" })
      .getAttribute("aria-pressed"),
    "true",
  );
  const collected = page.getByRole("region", {
    name: "Total collected, net",
    exact: true,
  });
  await collected.getByText("$193.99", { exact: true }).waitFor();
  await page
    .getByText("Completed refunds are shown on their completion dates", { exact: false })
    .waitFor();
  await page
    .getByText("whole orders containing a matching original product line", {
      exact: false,
    })
    .waitFor();
  assert.equal(await page.getByText(productId, { exact: true }).count(), 0);
  await page
    .getByRole("region", { name: "Average order value", exact: true })
    .getByText("$90.00", { exact: true })
    .waitFor();
  const waterfall = page.getByRole("region", { name: "Collected revenue waterfall" });
  await waterfall.getByText("View chart data").click();
  const unallocated = waterfall.getByRole("row", { name: /Unallocated refunds/ });
  assert.equal(await unallocated.count(), 1);
  await unallocated.getByRole("cell", { name: "-$10.01", exact: true }).waitFor();
  await capture("sales-activity-desktop");

  const payment = page.getByLabel("Payment method", { exact: true });
  const fulfillment = page.getByLabel("Fulfillment", { exact: true });
  await payment.selectOption("card");
  await collected.getByText("$193.99", { exact: true }).waitFor();
  assert.equal(requests.at(-1).searchParams.get("page"), "1");
  assert.equal(requests.at(-1).searchParams.get("productId"), productId);
  await fulfillment.selectOption("ship");
  await collected.getByText("$193.99", { exact: true }).waitFor();
  const basis = page.getByLabel("Date basis", { exact: true });
  await basis.selectOption("order-cohort");
  await collected.getByText("$184.00", { exact: true }).waitFor();
  await page
    .getByText(
      "Orders confirmed in the selected dates include subsequent completed refunds observed so far",
      { exact: false },
    )
    .waitFor();
  assert.match(new URL(page.url()).searchParams.get("dateBasis"), /^order-cohort$/);
  assert.equal(await waterfall.locator("ol").count(), 1);
  const actualQuery = requests.at(-1).searchParams;
  assert.equal(actualQuery.get("paymentMethod"), "card");
  assert.equal(actualQuery.get("fulfillment"), "ship");
  assert.equal(actualQuery.get("from"), "2026-11-10");
  assert.equal(actualQuery.get("to"), "2026-11-12");
  await page.goBack();
  await collected.getByText("$193.99", { exact: true }).waitFor();
  assert.equal(await basis.inputValue(), "activity");
  await page.goForward();
  await collected.getByText("$184.00", { exact: true }).waitFor();
  assert.equal(await basis.inputValue(), "order-cohort");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "sole-sales-2026-11-10-2026-11-12.csv");
  assert.equal(exports.at(-1).search, requests.at(-1).search);
  assert.match(
    await readFile(await download.path(), "utf8"),
    /totalCollected\.cents,18400/,
  );

  const trend = page.getByRole("region", { name: "Net product sales trend" });
  const histogram = page.getByRole("region", {
    name: "Order value distribution",
    exact: true,
  });
  for (const chart of [trend, waterfall, histogram]) {
    await chart.getByText("View chart data").focus();
    await page.keyboard.press("Enter");
    await chart.getByRole("table").waitFor();
  }
  await histogram.getByRole("row", { name: "$100.00 to under $250.00 1" }).waitFor();
  await waterfall
    .getByRole("row", { name: /Product refunds/ })
    .getByRole("cell", { name: "-$20.00" })
    .waitFor();
  await capture("sales-cohort-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  const tableRegions = page.locator(".analytics-table-scroll:visible");
  assert.ok((await tableRegions.count()) >= 4);
  assert.ok(
    await tableRegions.evaluateAll((regions) =>
      regions.every(
        (el) =>
          el.tabIndex === 0 &&
          el.getAttribute("aria-label") &&
          el.getBoundingClientRect().right <=
            el.closest(".analytics-panel").getBoundingClientRect().right,
      ),
    ),
  );
  const trendTable = trend.getByRole("region", {
    name: "Net product sales by reporting interval",
  });
  assert.equal(await trendTable.evaluate((el) => el.scrollWidth > el.clientWidth), true);
  await trendTable.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-label") ===
        "Net product sales by reporting interval" &&
      document.activeElement.scrollLeft > 0,
  );
  await capture("sales-cohort-390-open-tables");
  await basis.selectOption("activity");
  await collected.getByText("$193.99", { exact: true }).waitFor();
  await waterfall.getByText("View chart data").click();
  await unallocated.getByRole("cell", { name: "-$10.01", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await capture("sales-activity-390-open-waterfall");

  const productNavigation = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/admin/analytics/products",
  );
  await page.getByRole("button", { name: "View matching product lines" }).click();
  const products = new URL((await productNavigation).url()).searchParams;
  assert.equal(products.get("productId"), productId);
  assert.equal(products.get("paymentMethod"), "card");
  assert.equal(products.get("fulfillment"), "ship");
  assert.equal(products.get("from"), "2026-11-10");
  await page.goBack();
  await collected.getByText("$193.99", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear product filter" }).click();
  await collected.getByText("$193.99", { exact: true }).waitFor();
  assert.equal(requests.at(-1).searchParams.has("productId"), false);
  assert.equal(
    await page.getByRole("button", { name: "View matching product lines" }).count(),
    0,
  );
  console.log(
    "PASS: Sales boundary-crossing refunds, filter scopes, history, export, and responsive chart tables",
  );
}
