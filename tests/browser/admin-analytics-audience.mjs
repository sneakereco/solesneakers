import assert from "node:assert/strict";
import { productId } from "./admin-analytics-sales.mjs";

const variantId = "00000000-0000-4000-a000-000000000002";
const secondVariantId = "00000000-0000-4000-a000-000000000008";
const brandId = "00000000-0000-4000-a000-000000000003";
const categoryId = "00000000-0000-4000-a000-000000000004";
const sizeId = "00000000-0000-4000-a000-000000000005";
const priorProductId = "00000000-0000-4000-a000-000000000006";
const money = (cents) => ({ cents, complete: cents !== null, missingCount: 0 });
const rate = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});
const page = (rows, totalCount = rows.length, pageNumber = 1, pageSize = 50) => ({
  rows,
  totalCount,
  page: pageNumber,
  pageSize,
});

export const audienceQueries = Object.fromEntries(
  ["customers", "acquisition", "products"].map((report) => [
    report,
    new URLSearchParams({
      report,
      from: "2026-11-10",
      to: "2026-11-12",
      compare: "true",
      ...(report === "products" && { pageSize: "1" }),
    }),
  ]),
);

function customers(meta, compare) {
  const returning = meta.scope.filters.customer === "returning";
  const historical = {
    attribution: returning
      ? { eligibleOrders: 5, attributedOrders: 2 }
      : { eligibleOrders: 24, attributedOrders: 10 },
    visitors: 18,
    sessions: 30,
    buyers: returning ? 3 : 11,
    newBuyers: returning ? 0 : 8,
    returningBuyers: 3,
    missingBuyerOrders: returning ? 0 : 2,
    selectedPeriodSpend: money(returning ? 31003 : 102501),
    observedLifetimeSpend: money(returning ? 187242 : 370450),
    devices: page([
      { device: "mobile", sessions: 24, visitors: 15 },
      { device: "desktop", sessions: 6, visitors: 4 },
    ]),
    cohorts: returning
      ? []
      : [
          {
            month: "2026-11",
            buyers: 8,
            repeatPurchases: Array.from({ length: 12 }, (_, month) => ({
              monthsSinceFirstPurchase: month,
              repeatPurchaseRate: month ? rate(null, null) : rate(1, 8),
            })),
          },
        ],
  };
  const prior = {
    ...historical,
    attribution: { eligibleOrders: 9, attributedOrders: 3 },
    buyers: 5,
    returningBuyers: 1,
    newBuyers: 4,
    cohorts: [
      {
        month: "2026-11",
        buyers: 4,
        repeatPurchases: Array.from({ length: 12 }, (_, index) => ({
          monthsSinceFirstPurchase: index,
          repeatPurchaseRate: index ? rate(null, null) : rate(1, 4),
        })),
      },
    ],
    selectedPeriodSpend: money(25100),
    observedLifetimeSpend: money(91050),
    visitors: 8,
    sessions: 12,
    devices: page([{ device: "mobile", sessions: 12, visitors: 8 }]),
  };
  const recent = {
    activeFiveMinuteVisitors: 4,
    activeWindow: { start: "2026-11-26T01:51:00Z", end: "2026-11-26T01:56:00Z" },
  };
  if (Date.parse(meta.range.endExclusive) <= Date.parse(meta.datasetStartedAt)) {
    return {
      ...meta,
      scope: {
        ...meta.scope,
        attribution: { ...meta.scope.attribution, eligibleOrders: null },
      },
      behaviorThrough: null,
      coverage: [
        {
          code: "before-dataset-start",
          metric: "period",
          message:
            "The selected period predates activation. Only the independently verified recent activity window is available.",
        },
      ],
      state: "ready",
      data: {
        ...recent,
        comparison: null,
        attribution: null,
        visitors: null,
        sessions: null,
        buyers: null,
        newBuyers: null,
        returningBuyers: null,
        selectedPeriodSpend: money(null),
        observedLifetimeSpend: money(null),
        missingBuyerOrders: null,
        cohorts: null,
        devices: null,
      },
    };
  }
  return {
    ...meta,
    coverage: returning
      ? [
          {
            code: "inapplicable-filter",
            filter: "customer",
            metric: "traffic",
            message:
              "This business filter applies to confirmed commerce outcomes. Visitor and session activity retain their behavioral scope.",
          },
        ]
      : [],
    scope: {
      ...meta.scope,
      attribution: {
        ...meta.scope.attribution,
        ...historical.attribution,
        unattributedOrders:
          historical.attribution.eligibleOrders - historical.attribution.attributedOrders,
      },
    },
    state: "ready",
    data: {
      ...historical,
      comparison: compare ? prior : null,
      ...recent,
    },
  };
}

function acquisition(meta, compare, params) {
  const { source, device, channel, campaign } = meta.scope.filters;
  const view = (discovery, prior = false) => {
    const selected = discovery ? "instagram" : "google";
    const row = (
      key,
      sessions,
      confirmedOrders,
      cents,
      purchasingSessions = confirmedOrders,
    ) => ({
      key,
      label: key,
      sessions,
      purchasingSessions,
      confirmedOrders,
      revenue: money(cents),
    });
    const entries = prior
      ? [
          row("email", 3, discovery ? 1 : 2, 3000, 1),
          row("unattributed", 0, discovery ? 2 : 1, 2100, 0),
        ]
      : [
          row(selected, 14, 2, device === "mobile" ? 3501 : 9501),
          row("direct-unknown", 9, discovery ? 2 : 4, 16001, 1),
          row("unattributed", 0, discovery ? 4 : 2, 5000, 0),
        ];
    const scopedRows = entries.filter(({ key }) => {
      if (source && key !== source) return false;
      if (device && key === "unattributed") return false;
      if (channel && (key !== selected || channel !== (discovery ? "social" : "search")))
        return false;
      return (
        !campaign || (key === selected && campaign === (discovery ? "launch" : "sale"))
      );
    });
    const sourceRows =
      params.get("sort") === "revenue"
        ? [...scopedRows].sort((a, b) => b.revenue.cents - a.revenue.cents)
        : scopedRows;
    const start = prior ? meta.range.comparisonStartInclusive : meta.range.startInclusive;
    const end = prior ? meta.range.comparisonEndExclusive : meta.range.endExclusive;
    const segment = (rows, filter) => rows.filter(({ key }) => !filter || key === filter);
    // The selected November dates and their preceding dates all have 24-hour Eastern days.
    const day = 86_400_000;
    const dailyTotals = [
      { sessions: 0, orders: 0, cents: 0 },
      { sessions: 0, orders: 0, cents: 0 },
      { sessions: 0, orders: 0, cents: 0 },
    ];
    scopedRows.forEach((item, index) => {
      const totals = dailyTotals[index ? 2 : 0];
      totals.sessions += item.sessions;
      totals.orders += item.confirmedOrders;
      totals.cents += item.revenue.cents;
    });
    return {
      attribution: discovery
        ? { eligibleOrders: prior ? 3 : 8, attributedOrders: prior ? 1 : 4 }
        : { eligibleOrders: prior ? 3 : 8, attributedOrders: prior ? 2 : 6 },
      sources: page(sourceRows),
      channels: page(
        segment([row(discovery ? "social" : "search", 14, 2, 9501)], channel),
      ),
      campaigns: page(
        segment([row(discovery ? "launch" : "sale", 10, 2, 9501)], campaign),
      ),
      placements: page([row("homepage", 8, 1, 7100)]),
      series: dailyTotals.map(({ sessions, orders, cents }, index) => ({
        startInclusive: new Date(Date.parse(start) + index * day).toISOString(),
        endExclusive:
          index === 2
            ? end
            : new Date(Date.parse(start) + (index + 1) * day).toISOString(),
        visitors: sessions,
        sessions,
        confirmedOrders: orders,
        netMerchandise: money(cents),
      })),
    };
  };
  return {
    ...meta,
    coverage: [
      {
        code: "incomplete-coverage",
        metric: "purchaseSession",
        missingCount: 1,
        message: "Observations with invalid native session timing were excluded.",
      },
    ],
    state: "ready",
    data: {
      discovery: view(true),
      purchaseSession: view(false),
      comparison: compare
        ? { discovery: view(true, true), purchaseSession: view(false, true) }
        : null,
    },
  };
}

function products(meta, compare, params) {
  const { variantId: variant, device, source, ...filters } = meta.scope.filters;
  const requestedPage = Number(params.get("page") || 1);
  const pageSize = Number(params.get("pageSize") || 50);
  const ranked = (rows) =>
    page(
      rows.slice((requestedPage - 1) * pageSize, requestedPage * pageSize),
      rows.length,
      requestedPage,
      pageSize,
    );
  const failedSignals = variant && source && meta.range.partial;
  const attribution = variant
    ? { eligibleOrders: 1, attributedOrders: 1 }
    : { eligibleOrders: 3, attributedOrders: 2 };
  const filtered = Object.keys(filters).length > 0 || !!variant;
  const merchandise = money(device || source ? 1901 : filtered ? 8401 : 9801);
  const metrics = {
    confirmedOrders: 2,
    units: 3,
    netUnits: 2,
    views: 12,
    viewToPurchase: rate(2, 12),
    netMerchandise: merchandise,
  };
  const brand = { id: brandId, label: "Archive Athletics" };
  const category = { id: categoryId, label: "Sneakers" };
  const size = { id: sizeId, label: "US 11" };
  const product = {
    ...metrics,
    productId,
    variantId: null,
    name: "Retired High Top",
    brand,
    category,
    size: null,
    availableUnits: null,
    successfulAdditions: 5,
    variantSelections: 7,
    unavailableSizeRequests: 2,
    stockoutViews: 1,
  };
  const prior = {
    attribution: { eligibleOrders: 1, attributedOrders: 0 },
    products: ranked(
      filters.productId || variant
        ? []
        : [
            {
              ...product,
              productId: priorProductId,
              name: "Archive Low Top",
              units: 1,
              netUnits: 1,
              views: 1,
              confirmedOrders: 1,
              netMerchandise: money(1202),
            },
          ],
    ),
    variants: ranked([]),
    brands: ranked([]),
    categories: ranked([]),
    sizes: ranked([]),
    unmetDemand: null,
  };
  const variantRows = [
    { ...product, variantId, size, availableUnits: 4, stockoutViews: null },
    {
      ...product,
      variantId: secondVariantId,
      size: { id: secondVariantId, label: "US 12" },
      availableUnits: 3,
      stockoutViews: null,
      units: 1,
      netUnits: 1,
      netMerchandise: money(1234),
    },
  ].filter((row) => !variant || row.variantId === variant);
  return {
    ...meta,
    asOf: filters.productId && requestedPage > 1 ? "2026-11-26T01:59:00Z" : meta.asOf,
    scope: {
      ...meta.scope,
      attribution: {
        ...meta.scope.attribution,
        ...attribution,
        unattributedOrders: attribution.eligibleOrders - attribution.attributedOrders,
      },
    },
    state: "ready",
    coverage: [
      ...[
        device && "device",
        source && "source",
        filters.paymentMethod && "paymentMethod",
        filters.fulfillment && "fulfillment",
      ]
        .filter(Boolean)
        .map((filter) => ({
          code: "inapplicable-filter",
          metric: "inventory",
          filter,
          message: "Current stock does not use traffic or order filters.",
        })),
      ...(failedSignals
        ? [
            {
              code: "component-unavailable",
              metric: "signals",
              message: "Part of this report is unavailable.",
            },
          ]
        : []),
    ],
    data: {
      attribution,
      products: ranked([product]),
      variants: ranked(variantRows),
      brands: ranked([{ ...metrics, ...brand }]),
      categories: ranked([{ ...metrics, ...category }]),
      sizes: ranked([{ ...metrics, ...size }]),
      unmetDemand: failedSignals
        ? null
        : {
            stockoutSignals: variant ? null : 1,
            unavailableSizeSelections: 2,
            searchesWithNoResults: filtered ? null : 3,
            searches: filtered ? null : 19,
            variantSelections: 7,
          },
      inventory: failedSignals
        ? null
        : {
            scope: "recorded-variants",
            recordedVariants: variantRows.length,
            missingStockVariants: 0,
            catalogVariants: null,
            asOf: "2026-11-25T15:20:00Z",
            availableUnits: variantRows.reduce(
              (total, row) => total + row.availableUnits,
              0,
            ),
            inStockVariants: variantRows.length,
            outOfStockVariants: 0,
          },
      comparison: compare ? prior : null,
    },
  };
}

export const audienceFixtures = { customers, acquisition, products };

async function mobileTables(page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  const tables = page.locator(".analytics-table-scroll:visible");
  assert.ok((await tables.count()) > 0);
  assert.ok(
    await tables.evaluateAll((elements) =>
      elements.every(
        (table) =>
          table.tabIndex === 0 &&
          table.getAttribute("aria-label") &&
          table.getBoundingClientRect().right <=
            table.closest(".analytics-panel").getBoundingClientRect().right + 1,
      ),
    ),
  );
}

const metric = (page, name) => page.getByRole("region", { name, exact: true });

export const audienceScenarios = {
  async customers({ page, capture }) {
    await metric(page, "Returning buyers")
      .getByText("3", { exact: true })
      .waitFor({ timeout: 5000 });
    await metric(page, "New buyers").getByText("8", { exact: true }).waitFor();
    await metric(page, "Tracked visitors").getByText("18", { exact: true }).waitFor();
    await metric(page, "Selected-period spend")
      .getByText("$1,025.01", { exact: true })
      .waitFor();
    await metric(page, "Observed lifetime spend")
      .getByText("$3,704.50", { exact: true })
      .waitFor();
    await metric(page, "Active visitors in five observed minutes")
      .getByText("4", { exact: true })
      .waitFor();
    await page.getByText(/8:51 PM ET.*8:56 PM ET/).waitFor();
    await page.getByText(/Analytics since/).waitFor();
    const heatmap = page.getByRole("region", { name: "Buyer cohort heatmap" });
    assert.equal(await heatmap.locator('[aria-label="Not elapsed"]').count(), 11);
    await page.getByRole("row", { name: /Mobile.*15.*24.*80%/ }).waitFor();
    await page.getByText(/10 of 24 attributed/).waitFor();
    await page.getByText(/3 of 9 attributed/).waitFor({ timeout: 5000 });
    const buyer = page.getByLabel("Buyer type", { exact: true });
    const returningSpend = metric(page, "Selected-period spend").getByText("$310.03", {
      exact: true,
    });
    await buyer.selectOption("returning");
    await returningSpend.waitFor();
    await metric(page, "Recorded buyers").getByText("3", { exact: true }).waitFor();
    await metric(page, "Observed lifetime spend")
      .getByText("$1,872.42", { exact: true })
      .waitFor();
    await metric(page, "Tracked sessions").getByText("30", { exact: true }).waitFor();
    await page
      .getByText(/Visitor and session activity retain their behavioral scope/)
      .waitFor();
    assert.match(page.url(), /customer=returning/);
    await page.goBack();
    await heatmap.waitFor();
    assert.equal(await buyer.inputValue(), "");
    await page.goForward();
    await returningSpend.waitFor();
    assert.equal(await buyer.inputValue(), "returning");
    await buyer.selectOption("");
    await heatmap.waitFor();
    assert.equal(new URL(page.url()).searchParams.has("customer"), false);
    await capture("customers-desktop");
    await mobileTables(page);
    await heatmap.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.activeElement?.scrollLeft > 0);
    await capture("customers-390");
    await page.getByRole("button", { name: /^Date range/ }).click();
    const calendar = page.getByRole("dialog", { name: "Choose a date range" });
    await calendar.getByLabel("Start date").fill("2023-11-10");
    await calendar.getByLabel("End date").fill("2023-11-12");
    await calendar.getByRole("button", { name: "Apply range" }).click();
    await page.getByText(/The selected period predates activation/).waitFor();
    await metric(page, "Recorded buyers")
      .getByText("Unavailable", { exact: true })
      .waitFor();
    await metric(page, "Active visitors in five observed minutes")
      .getByText("4", { exact: true })
      .waitFor();
    await page.getByText(/Analytics since Jan 1, 2024/).waitFor();
    await capture("customers-history-boundary-390");
    console.log(
      "PASS: Customers buyer history, observed activity, device shares, and responsive cohorts",
    );
  },
  async acquisition({ page, requests, capture }) {
    const sources = page.getByRole("region", { name: "Reported sources", exact: true });
    await page.getByLabel("Order status", { exact: true }).waitFor({ timeout: 5000 });
    await page.getByLabel("Payment method", { exact: true }).selectOption("card");
    await sources
      .getByRole("rowheader", { name: "Google", exact: true })
      .waitFor({ timeout: 5000 });
    await sources
      .getByRole("rowheader", { name: "Direct / unknown", exact: true })
      .waitFor();
    await sources.getByRole("rowheader", { name: "Unattributed", exact: true }).waitFor();
    await page
      .getByText(/6 of 8 attributed · 2 unattributed/)
      .first()
      .waitFor();
    const timing = page.getByText(
      "Observations with invalid native session timing were excluded.",
    );
    await timing.waitFor();
    const initialCount = requests.length;
    const view = page.getByLabel("Attribution view");
    await view.selectOption("discovery");
    await sources.getByRole("rowheader", { name: "Instagram", exact: true }).waitFor();
    assert.equal(await timing.count(), 0);
    await page
      .getByText(/4 of 8 attributed · 4 unattributed/)
      .first()
      .waitFor();
    assert.equal(requests.length, initialCount);
    await page.goBack();
    assert.equal(await view.inputValue(), "purchase-session");
    await page.goForward();
    assert.equal(await view.inputValue(), "discovery");
    assert.equal(requests.length, initialCount);
    await page.getByLabel("Rank by").selectOption("revenue");
    await sources.getByRole("rowheader", { name: "Direct / unknown" }).first().waitFor();
    assert.equal(
      await sources.getByRole("rowheader").first().textContent(),
      "Direct / unknown",
    );
    assert.equal(requests.at(-1).searchParams.get("sort"), "revenue");
    assert.equal(requests.at(-1).searchParams.has("attribution"), false);
    await capture("acquisition-desktop");
    await page.getByLabel("Channel", { exact: true }).selectOption("social");
    await sources.getByRole("rowheader", { name: "Instagram", exact: true }).waitFor();
    await page.getByLabel("Campaign", { exact: true }).selectOption("launch");
    await sources.getByRole("rowheader", { name: "Instagram", exact: true }).waitFor();
    await page.getByLabel("Source", { exact: true }).selectOption("instagram");
    await sources.getByRole("cell", { name: "$95.01", exact: true }).waitFor();
    await page.getByLabel("Device", { exact: true }).selectOption("mobile");
    await sources.getByRole("cell", { name: "$35.01", exact: true }).waitFor();
    assert.equal(requests.at(-1).searchParams.get("source"), "instagram");
    assert.equal(requests.at(-1).searchParams.get("device"), "mobile");
    assert.equal(requests.at(-1).searchParams.get("channel"), "social");
    assert.equal(requests.at(-1).searchParams.get("campaign"), "launch");
    assert.equal(requests.at(-1).searchParams.get("paymentMethod"), "card");
    await page
      .getByRole("region", { name: "Net product sales trend" })
      .getByText("View chart data")
      .click();
    const salesTrend = page.getByRole("region", {
      name: "Net product sales by reporting interval",
    });
    assert.equal(await salesTrend.getByRole("row").count(), 7);
    await salesTrend
      .getByRole("row", { name: /Nov 11, 2026.*Selected period/ })
      .getByRole("cell", { name: "$0.00", exact: true })
      .waitFor();
    await mobileTables(page);
    await capture("acquisition-390-open-table");
    await page
      .getByRole("navigation", { name: "Analytics reports" })
      .getByRole("button", { name: "Products", exact: true })
      .click();
    const productTable = page.getByRole("region", {
      name: "Selected product sales",
      exact: true,
    });
    await productTable.getByRole("cell", { name: "$19.01", exact: true }).waitFor();
    assert.equal(requests.at(-1).searchParams.get("source"), "instagram");
    assert.equal(requests.at(-1).searchParams.get("device"), "mobile");
    await page
      .getByText("Current stock does not use traffic or order filters.")
      .waitFor();
    await page.getByText(/2 of 3 attributed · 1 unattributed/).waitFor();
    await page.getByRole("button", { name: /^Date range/ }).click();
    const calendar = page.getByRole("dialog", { name: "Choose a date range" });
    await calendar.getByLabel("End date").fill("2026-11-25");
    await calendar.getByRole("button", { name: "Apply range" }).click();
    const variantTrigger = page.getByRole("button", {
      name: "View Retired High Top, US 11 details",
    });
    await variantTrigger.click();
    const drawer = page.getByRole("dialog", { name: "Retired High Top · US 11" });
    await drawer.getByText("$19.01", { exact: true }).waitFor();
    await drawer.getByText(/Nov 10\s*[–-]\s*25, 2026/).waitFor();
    await drawer.getByText("Today is included as a partial day.").waitFor();
    await drawer.getByText(/1 of 1 attributed · 0 unattributed/).waitFor();
    await drawer
      .getByText(/orders attributable to the selected device or acquisition segment/)
      .waitFor();
    await drawer.getByText("Part of this report is unavailable.").waitFor();
    const value = (label, expected) =>
      drawer
        .getByText(label, { exact: true })
        .locator("..")
        .getByText(expected, { exact: true });
    await value("Unavailable size selections", "2").waitFor();
    await value("Variant selections", "7").waitFor();
    await value(
      "Product views with all known sizes out of stock",
      "Unavailable",
    ).waitFor();
    assert.equal(requests.at(-1).searchParams.get("variantId"), variantId);
    assert.equal(requests.at(-1).searchParams.get("source"), "instagram");
    await capture("products-source-filtered-partial-mobile-drawer");
    await value("Unavailable size selections", "2").scrollIntoViewIfNeeded();
    await capture("products-source-filtered-demand-mobile-drawer");
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    console.log(
      "PASS: Acquisition view-specific coverage, ranking, scoped money, daily trends, and mobile tables",
    );
  },
  async products({ page, requests, capture }) {
    const trigger = page.getByRole("button", { name: "View Retired High Top details" });
    await trigger.waitFor({ timeout: 5000 });
    await page.getByRole("heading", { name: "Current recorded inventory" }).waitFor();
    await page.getByText(/0 of 1 attributed · 1 unattributed/).waitFor({ timeout: 5000 });
    await page.getByLabel("Brand", { exact: true }).selectOption(brandId);
    await trigger.waitFor();
    assert.equal(requests.at(-1).searchParams.get("brandId"), brandId);
    await page.getByLabel("Brand", { exact: true }).selectOption("");
    await trigger.waitFor();
    await capture("products-desktop");
    await page.getByText("Previous period product sales", { exact: true }).click();
    const comparison = page.getByRole("region", {
      name: "Previous period product sales table",
    });
    await comparison.getByRole("rowheader", { name: "Archive Low Top" }).waitFor();
    assert.equal(await comparison.getByText("Retired High Top").count(), 0);
    await mobileTables(page);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Retired High Top" });
    await drawer.getByText("$84.01", { exact: true }).first().waitFor();
    await drawer
      .getByText("Financial results cover matching original product lines.", {
        exact: true,
      })
      .waitFor();
    assert.equal(requests.at(-1).searchParams.get("productId"), productId);
    assert.equal(requests.at(-1).searchParams.get("page"), "1");
    await drawer.getByText("Archive Athletics", { exact: true }).first().waitFor();
    await drawer.getByText("US 11", { exact: true }).first().waitFor();
    await drawer.getByText("Unavailable size selections", { exact: true }).waitFor();
    await mobileTables(page);
    assert.ok(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await capture("products-390-open-drawer");
    const variants = drawer.getByRole("region", {
      name: "Scoped variant sales and current stock",
    });
    const pager = drawer.getByRole("navigation", { name: "Scoped variant pages" });
    const next = pager.getByRole("button", { name: "Next page" });
    const previous = pager.getByRole("button", { name: "Previous page" });
    const parentUrl = page.url();
    const delayedRoute = /\/api\/admin\/analytics\/products\?/;
    let releaseDelayed;
    let finishDelayed;
    const delay = new Promise((resolve) => {
      releaseDelayed = resolve;
    });
    const delayed = new Promise((resolve) => {
      finishDelayed = resolve;
    });
    const isSecondScopedPage = (url) => {
      const params = new URL(url).searchParams;
      return params.get("productId") === productId && params.get("page") === "2";
    };
    const holdSecondPage = async (route) => {
      if (!isSecondScopedPage(route.request().url())) return route.fallback();
      await delay;
      try {
        await route.fallback();
      } catch (error) {
        if (!route.request().failure()) throw error;
      } finally {
        finishDelayed();
      }
    };
    await page.route(delayedRoute, holdSecondPage);
    const requestedSecondPage = page.waitForRequest((request) =>
      isSecondScopedPage(request.url()),
    );
    await next.click();
    const obsoleteRequest = await requestedSecondPage;
    const obsoleteCanceled = page.waitForEvent("requestfailed", {
      predicate: (request) => request === obsoleteRequest,
    });
    await drawer.getByText("Loading product details…").waitFor();
    assert.equal(await variants.count(), 0);
    assert.equal(await pager.evaluate((el) => el === document.activeElement), true);
    await previous.click();
    await variants.getByText("US 11", { exact: true }).waitFor();
    releaseDelayed();
    await delayed;
    await obsoleteCanceled;
    await page.unroute(delayedRoute, holdSecondPage);
    assert.equal(await variants.getByText("US 12", { exact: true }).count(), 0);
    await next.click();
    await variants.getByText("US 12", { exact: true }).waitFor();
    await variants.getByText("$12.34", { exact: true }).waitFor();
    await drawer.getByText("Product summary from the first scoped page").waitFor();
    await drawer.getByText(/Report as of Nov 25, 2026, 8:58 PM ET/).waitFor();
    await drawer.getByText(/Report as of Nov 25, 2026, 8:59 PM ET/).waitFor();
    await mobileTables(page);
    await capture("products-390-variant-page-two-coverage-drawer");
    await variants.scrollIntoViewIfNeeded();
    await capture("products-390-variant-page-two-drawer");
    assert.equal(page.url(), parentUrl);
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
    assert.equal(new URL(page.url()).searchParams.get("page"), "1");
    const variantTrigger = page.getByRole("button", {
      name: "View Retired High Top, US 11 details",
    });
    await page.setViewportSize({ width: 1440, height: 980 });
    await variantTrigger.click();
    const variantDrawer = page.getByRole("dialog", { name: "Retired High Top · US 11" });
    await variantDrawer.getByText("$84.01", { exact: true }).first().waitFor();
    assert.equal(requests.at(-1).searchParams.get("variantId"), variantId);
    await capture("products-variant-desktop-drawer");
    await variantDrawer.getByRole("button", { name: "Close product details" }).click();
    assert.equal(
      await variantTrigger.evaluate((el) => document.activeElement === el),
      true,
    );
    console.log(
      "PASS: Products snapshots, independent previous ranking, filtered drawer, stock, and keyboard focus",
    );
  },
};
