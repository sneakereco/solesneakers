import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const args = process.argv.slice(2);
assert.ok(
  !args.length || (args.length === 2 && args[0] === "--report" && args[1] === "overview"),
  "Usage: node tests/browser/admin-analytics.mjs [--report overview]",
);

console.log("Bundling admin analytics browser fixture");
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import { AdminSidebar } from './src/components/admin/AdminSidebar';
      import { AdminTopbar } from './src/components/admin/AdminTopbar';
      import Loading from './src/app/admin/analytics/loading';
      import { AnalyticsPageClient } from './src/Modules/Analytics/Source/Features/Dashboard/AnalyticsPageClient';
      import { readDashboardLocation } from './src/Modules/Analytics/Source/Features/Dashboard/request-state';

      const root = createRoot(document.getElementById('root'));
      function render(content) {
        root.render(<div data-admin-shell className="min-h-screen">
          <AdminSidebar role="admin" userEmail="staff@example.test" />
          <div className="flex min-h-screen flex-col md:ml-[17.5rem]">
            <AdminTopbar />
            <main data-admin-content className="flex-1 px-4 pb-12 pt-5 sm:px-6 md:px-8 md:pb-16 md:pt-8 xl:px-10">
              <div className="mx-auto w-full max-w-[96rem]">{content}</div>
            </main>
          </div>
        </div>);
      }
      if (location.pathname === '/admin/analytics') {
        render(<Loading />);
        window.finishAnalyticsLoad = (report) => {
          const initialRequest = readDashboardLocation(new URLSearchParams(location.search), new Date());
          render(<AnalyticsPageClient initialRequest={initialRequest} initialReport={{ ...report, range: initialRequest.request.range }} />);
        };
      } else render(<h1>Dashboard</h1>);
    `,
  },
  bundle: true,
  write: false,
  outdir: "out",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "admin-fixture-navigation",
      setup(builder) {
        builder.onResolve({ filter: /^next\/(link|navigation)$/ }, ({ path }) => ({
          path,
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          resolveDir: process.cwd(),
          loader: "jsx",
          contents:
            path === "next/link"
              ? "export default function Link({ prefetch, ...props }) { return <a {...props} />; }"
              : "export const usePathname = () => location.pathname;",
        }));
      },
    },
  ],
});

console.log("Compiling admin analytics fixture styles");
const siteCss = await postcss([
  tailwindcss({
    content: ["./src/**/*.{ts,tsx}", "./tests/browser/admin-analytics.mjs"],
  }),
]).process(await readFile("src/styles/site.css", "utf8"), {
  from: "src/styles/site.css",
});
const calendarCss =
  bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
const appScript = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;

const money = (cents) => ({
  cents,
  complete: cents !== null,
  missingCount: cents === null ? 1 : 0,
});
const rate = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});
const components = {
  grossMerchandise: money(140_000),
  discounts: money(9_525),
  merchandiseRefunds: money(7_019),
  shippingCollected: money(3_000),
  shippingRefunds: money(0),
  taxCollected: money(9_000),
  taxRefunds: money(0),
  unallocatedRefunds: money(null),
  netMerchandise: money(123_456),
  netShipping: money(3_000),
  netTax: money(9_000),
  totalCollected: money(null),
};
const summary = {
  netMerchandise: money(123_456),
  confirmedOrders: 8,
  averageOrderValue: money(16_309),
  conversion: rate(5, 40),
  visitors: 31,
  sessions: 40,
  buyers: 7,
  missingBuyerOrders: 0,
};
const product = {
  productId: "00000000-0000-4000-a000-000000000001",
  variantId: null,
  name: "Canvas Low",
  brand: null,
  category: null,
  size: null,
  confirmedOrders: 2,
  units: 2,
  netUnits: 2,
  views: 9,
  viewToPurchase: rate(2, 9),
  netMerchandise: money(31_210),
  successfulAdditions: 4,
  variantSelections: null,
  unavailableSizeRequests: null,
  stockoutViews: null,
  availableUnits: null,
};
const coverageIssue = (metric) => ({
  code: "component-unavailable",
  metric,
  message: "Part of this report is unavailable.",
});
const oneDay = 86_400_000;
const storeOffset = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  timeZoneName: "shortOffset",
});
function fixtureMidnight(day) {
  const offset = storeOffset
    .formatToParts(day)
    .find(({ type }) => type === "timeZoneName").value;
  return new Date(day - Number(offset.slice(3)) * 3_600_000).toISOString();
}

console.log("Launching Chromium for the admin analytics fixture");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 980 },
    timezoneId: "Asia/Tokyo",
    acceptDownloads: true,
  });
  await page.addInitScript(() => {
    const fetchRequest = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input, location.href);
      if (
        url.pathname === "/api/admin/analytics/overview" &&
        url.searchParams.get("device") === "mobile"
      ) {
        // Exercise a transport which has already advanced past the point abort can prevent its result.
        options.signal.addEventListener("abort", () => {
          window.analyticsMobileAborted = true;
        });
        return fetchRequest(input, { ...options, signal: undefined }).then((response) => {
          const readJson = response.json.bind(response);
          response.json = () =>
            readJson().then((result) => {
              requestAnimationFrame(() => {
                window.analyticsMobileDecoded = true;
              });
              return result;
            });
          return response;
        });
      }
      return fetchRequest(input, options);
    };
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let mode = "ready";
  let exportMode = "csv";
  let holdMobile;
  const requests = [];

  function fixture(params = new URLSearchParams()) {
    const from = params.get("from") ?? "2026-10-27";
    const to = params.get("to") ?? "2026-11-25";
    const day = (value) => Date.parse(`${value}T00:00:00Z`);
    const days = (day(to) - day(from)) / oneDay + 1;
    const compare = params.get("compare") === "true";
    const requestFilters = Object.fromEntries(
      [...params].filter(([key]) =>
        [
          "device",
          "source",
          "channel",
          "campaign",
          "paymentMethod",
          "fulfillment",
          "customer",
          "status",
          "productId",
          "variantId",
          "brandId",
          "categoryId",
          "sizeId",
        ].includes(key),
      ),
    );
    const start = fixtureMidnight(day(from));
    const priorDay = day(from) - days * oneDay;
    const prior = fixtureMidnight(priorDay);
    const end = fixtureMidnight(day(to) + oneDay);
    const meta = {
      range: {
        from,
        to,
        timezone: "America/New_York",
        startInclusive: start,
        endExclusive: end,
        calendarDays: days,
        comparisonStartInclusive: prior,
        comparisonEndExclusive: start,
        partial: to === "2026-11-25",
      },
      scope: {
        dataset: {
          datasetId: "fixture",
          storefront: "sole",
          environment: "staging",
          currency: "USD",
        },
        dateBasis: params.get("dateBasis") ?? "activity",
        filters: requestFilters,
        attribution: {
          orderScope: Object.keys(requestFilters).length
            ? "filtered-orders"
            : "all-orders",
          eligibleOrders: 8,
          attributedOrders: null,
          unattributedOrders: null,
        },
      },
      asOf: "2026-11-26T01:58:00Z",
      ingestionAsOf: "2026-11-26T01:55:00Z",
      behaviorThrough: "2026-11-26T01:56:00Z",
      datasetStartedAt: "2024-01-01T05:00:00Z",
      coverage: [],
    };
    if (mode === "unconfigured")
      return {
        ...meta,
        scope: { ...meta.scope, dataset: null },
        ingestionAsOf: null,
        behaviorThrough: null,
        datasetStartedAt: null,
        coverage: [
          {
            code: "component-unavailable",
            message: "An activated analytics dataset is unavailable.",
          },
        ],
        state: mode,
        data: null,
      };
    if (mode === "unavailable")
      return { ...meta, state: mode, coverage: [coverageIssue("warehouse")], data: null };

    const selectedSummary = {
      ...summary,
      ...(mode === "review-coverage"
        ? { confirmedOrders: 2, buyers: 0, missingBuyerOrders: 2 }
        : {}),
      netMerchandise: money(
        params.get("device") === "mobile"
          ? 70_001
          : params.get("device") === "desktop"
            ? 21_002
            : 123_456,
      ),
    };
    const comparisonSummary = {
      ...summary,
      confirmedOrders: 6,
      netMerchandise: money(112_000),
      ...(mode === "review-coverage"
        ? {
            confirmedOrders: 2,
            buyers: 1,
            missingBuyerOrders: 1,
            netMerchandise: { cents: 112_000, complete: false, missingCount: 2 },
            averageOrderValue: { cents: 15_773, complete: false, missingCount: 1 },
          }
        : {}),
    };
    function seriesFrom(firstDay, totals) {
      const cents = totals.netMerchandise.cents;
      const intervals = [];
      for (let offset = 0; offset < days; ) {
        const bucketStart = firstDay + offset * oneDay;
        const weekday = new Date(bucketStart).getUTCDay();
        const remaining = params.get("bucket") === "week" ? 7 - ((weekday + 6) % 7) : 1;
        const stop = Math.min(days, offset + remaining);
        intervals.push([bucketStart, firstDay + stop * oneDay]);
        offset = stop;
      }
      const weights =
        intervals.length <= 2
          ? [1, 0]
          : intervals.map((_, index) => [4, 7, 5, 8, 3, 5, 6][index % 7]);
      const sum = weights.reduce((total, weight) => total + weight, 0);
      let assigned = 0;
      return intervals.map(([bucketStart, bucketEnd], index) => {
        const amount =
          index === intervals.length - 1
            ? cents - assigned
            : Math.floor((cents * weights[index]) / sum);
        assigned += amount;
        return {
          startInclusive: fixtureMidnight(bucketStart),
          endExclusive: fixtureMidnight(bucketEnd),
          netMerchandise:
            index === 0 ? { ...totals.netMerchandise, cents: amount } : money(amount),
          confirmedOrders: index === 0 ? totals.confirmedOrders : 0,
          sessions: index === 0 ? totals.sessions : 0,
          visitors: index === 0 ? totals.visitors : 0,
        };
      });
    }
    const series = seriesFrom(day(from), selectedSummary);
    const data = {
      summary: selectedSummary,
      comparison: compare ? comparisonSummary : null,
      series,
      comparisonSeries: compare ? seriesFrom(priorDay, comparisonSummary) : null,
      funnel: ["session", "product-view", "cart-addition", "checkout", "purchase"].map(
        (step, index) => {
          const counts = [40, 22, 9, 6, 5];
          return {
            step,
            sessions: counts[index],
            fromStart: rate(counts[index], 40),
            fromPrevious: rate(counts[index], counts[index - 1] ?? 40),
          };
        },
      ),
      leadingSources: [
        {
          key: "social",
          label: "Social",
          sessions: null,
          purchasingSessions: 3,
          confirmedOrders: 4,
          revenue: money(63_200),
        },
      ],
      leadingProducts: [product],
      components,
    };
    if (mode === "empty")
      return {
        ...meta,
        state: mode,
        data: {
          ...data,
          summary: {
            netMerchandise: money(0),
            confirmedOrders: 0,
            averageOrderValue: money(null),
            conversion: rate(0, 0),
            visitors: 0,
            sessions: 0,
            buyers: 0,
            missingBuyerOrders: 0,
          },
          series: series.map((bucket) => ({
            ...bucket,
            netMerchandise: money(0),
            confirmedOrders: 0,
            sessions: 0,
            visitors: 0,
          })),
          funnel: data.funnel.map((step) => ({
            ...step,
            sessions: 0,
            fromStart: rate(0, 0),
            fromPrevious: rate(0, 0),
          })),
          components: Object.fromEntries(
            Object.keys(components).map((key) => [key, money(0)]),
          ),
          leadingSources: [],
          leadingProducts: [],
        },
        coverage: [coverageIssue("purchaseSession")],
      };
    if (mode === "stale")
      return { ...meta, state: mode, data, coverage: [coverageIssue("freshness")] };
    if (mode === "product-failure")
      return {
        ...meta,
        state: "ready",
        data: { ...data, leadingProducts: [] },
        coverage: [coverageIssue("products")],
      };
    return { ...meta, state: "ready", data };
  }

  await page.route("https://admin.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/app.js")
      return route.fulfill({ contentType: "application/javascript", body: appScript });
    if (url.pathname === "/app.css")
      return route.fulfill({
        contentType: "text/css",
        body: `${calendarCss}\n${siteCss.css}`,
      });
    if (["/admin/dashboard", "/admin/analytics"].includes(url.pathname))
      return route.fulfill({
        contentType: "text/html",
        body: '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script defer src="/app.js"></script>',
      });
    if (!url.pathname.startsWith("/api/admin/analytics/")) return route.abort();
    if (url.pathname.endsWith("/export")) {
      if (exportMode === "gate")
        return route.fulfill({ status: 200, contentType: "text/html", body: "Sign in" });
      if (exportMode === "limit")
        return route.fulfill({
          status: 422,
          json: { error: "Choose a shorter date range or apply filters." },
        });
      return route.fulfill({
        contentType: "text/csv; charset=utf-8",
        body: "field,value,status\nsummary.confirmedOrders,8,known\n",
      });
    }
    requests.push(url);
    const device = url.searchParams.get("device");
    const response = fixture(url.searchParams);
    if (mode === "gate")
      return route.fulfill({
        status: 403,
        contentType: "text/html",
        body: "Verify access",
      });
    if (mode === "failure")
      return route.fulfill({
        status: 503,
        json: { error: "Analytics reporting is temporarily unavailable." },
      });
    if (device === "mobile" && holdMobile) await holdMobile;
    await route.fulfill({ json: response }).catch((error) => {
      if (!route.request().failure()) throw error;
    });
  });

  const origin = "https://admin.test";
  await page.goto(`${origin}/admin/dashboard`);
  const analyticsLink = page.getByRole("link", { name: "Analytics", exact: true });
  await analyticsLink.click();
  await page.getByRole("status").getByText("Loading analytics report").waitFor();
  await page.clock.setFixedTime(new Date("2026-11-26T02:00:00Z"));
  assert.deepEqual(
    await page.evaluate(() => [
      new Date().toISOString(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ]),
    ["2026-11-26T02:00:00.000Z", "Asia/Tokyo"],
  );
  await page.waitForFunction(() => Boolean(window.finishAnalyticsLoad));
  await page.evaluate((report) => window.finishAnalyticsLoad(report), fixture());
  await page.getByRole("heading", { name: "Analytics", exact: true }).waitFor();
  assert.equal(await analyticsLink.getAttribute("aria-current"), "page");
  assert.equal(
    await page.locator("[data-admin-topbar]").getByText("Analytics").count(),
    1,
  );
  await page.getByText("30 days · Eastern Time", { exact: true }).waitFor();
  await page.waitForURL(/from=2026-10-27&to=2026-11-25/);
  console.log("PASS: native admin navigation, loading state, and default range");

  const screenshots = process.env.ANALYTICS_BROWSER_SCREENSHOTS;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  async function capture(name) {
    if (!screenshots) return;
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: join(screenshots, `${name}.png`),
      fullPage: !name.startsWith("calendar-"),
    });
  }
  await capture("overview-desktop");

  const dateButton = page.getByRole("button", { name: /^Date range/ });
  const dialog = page.getByRole("dialog", { name: "Choose a date range" });
  const apply = dialog.getByRole("button", { name: "Apply range" });
  const start = dialog.getByLabel("Start date");
  const end = dialog.getByLabel("End date");
  await dateButton.focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  assert.equal(await dialog.locator(".rdp-month").count(), 2);
  const monthBounds = await dialog
    .locator(".rdp-month")
    .evaluateAll((months) => months.map((month) => month.getBoundingClientRect().top));
  assert.equal(
    monthBounds[0],
    monthBounds[1],
    "Desktop calendar months are side by side",
  );
  assert.equal(await start.evaluate((el) => el === document.activeElement), true);
  await apply.focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await dialog
      .getByRole("button", { name: "Close date picker" })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Shift+Tab");
  assert.equal(await apply.evaluate((el) => el === document.activeElement), true);
  await start.focus();
  await capture("calendar-desktop");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await dateButton.evaluate((el) => el === document.activeElement), true);

  await dateButton.click();
  await dialog.getByRole("button", { name: /November 3rd, 2026/ }).click();
  await dialog.getByRole("button", { name: /November 19th, 2026/ }).click();
  await dialog.getByText("17 inclusive days", { exact: true }).waitFor();
  await apply.click();
  await page.getByText("17 days · Eastern Time", { exact: true }).waitFor();
  assert.match(page.url(), /from=2026-11-03&to=2026-11-19/);

  await dateButton.click();
  await dialog.getByRole("button", { name: /November 4th, 2026/ }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await dialog.getByText("1 inclusive day", { exact: true }).waitFor();
  await apply.click();
  assert.match(page.url(), /from=2026-11-05&to=2026-11-05/);
  await dateButton.click();
  await dialog.getByRole("button", { name: "Last 7 days" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  assert.match(page.url(), /from=2026-11-05&to=2026-11-05/);

  for (const [from, to, days] of [
    ["2026-10-31", "2026-11-02", 3],
    ["2024-02-29", "2024-02-29", 1],
    ["2025-12-31", "2026-01-01", 2],
  ]) {
    await dateButton.click();
    await start.fill(from);
    await end.fill(to);
    await dialog
      .getByText(`${days} inclusive ${days === 1 ? "day" : "days"}`, { exact: true })
      .waitFor();
    await apply.click();
    assert.equal(new URL(page.url()).searchParams.get("from"), from);
    assert.equal(new URL(page.url()).searchParams.get("to"), to);
  }
  await page.getByRole("checkbox", { name: "Compare previous period" }).check();
  await page.getByText(/Previous period · Dec 29/).waitFor();
  const device = page.getByLabel("Device", { exact: true });
  let releaseMobile;
  holdMobile = new Promise((resolve) => {
    releaseMobile = resolve;
  });
  const lateResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("device") === "mobile",
  );
  await device.selectOption("mobile");
  await page.getByText("Updating report", { exact: true }).waitFor();
  await device.selectOption("desktop");
  await page.getByText("$210.02", { exact: true }).first().waitFor();
  releaseMobile();
  holdMobile = undefined;
  await lateResponse;
  await page.waitForFunction(() => Boolean(window.analyticsMobileDecoded));
  assert.equal(await page.evaluate(() => window.analyticsMobileAborted), true);
  assert.equal(await page.getByText("$700.01", { exact: true }).count(), 0);
  assert.equal(new URL(page.url()).searchParams.get("device"), "desktop");
  await page.goBack();
  await page.getByText("$700.01", { exact: true }).first().waitFor();
  assert.equal(await device.inputValue(), "mobile");
  await page.goForward();
  await page.getByText("$210.02", { exact: true }).first().waitFor();
  console.log(
    "PASS: calendar, Eastern date boundaries, comparison, URL history, and late response discard",
  );

  await page.getByText(/Attribution coverage unavailable/).waitFor();
  const trend = page.getByRole("region", { name: "Net product sales trend" });
  await trend.getByText("View chart data").focus();
  await page.keyboard.press("Enter");
  await trend.getByRole("cell", { name: "$210.02", exact: true }).waitFor();
  await trend.getByRole("cell", { name: "$1,120.00", exact: true }).waitFor();
  await capture("overview-chart-table-desktop");
  const funnel = page.getByRole("region", { name: "Shopping funnel" });
  await funnel.getByText("View chart data").click();
  await funnel.getByRole("cell", { name: /^12\.5% \(5 \/ 40\)$/ }).waitFor();

  mode = "product-failure";
  await device.selectOption("tablet");
  await page.getByText("Leading products are unavailable.").waitFor();
  await page
    .getByRole("region", { name: "Purchase-session sources", exact: true })
    .getByText("Social", { exact: true })
    .first()
    .waitFor();

  for (const state of [
    "empty",
    "stale",
    "unconfigured",
    "unavailable",
    "failure",
    "gate",
  ]) {
    mode = state;
    await device.selectOption((await device.inputValue()) === "" ? "tablet" : "");
    const message = {
      empty: "No activity during the selected period.",
      stale: "Showing the most recent available report.",
      unconfigured: "Analytics setup is incomplete.",
      unavailable: "This report is unavailable.",
      failure: "Analytics reporting is temporarily unavailable.",
      gate: "Admin access is required to view this report.",
    }[state];
    await page.getByText(message, { exact: true }).waitFor();
    if (state === "empty") {
      await page.getByText("Purchase-session sources are unavailable.").waitFor();
      await page.getByText("No products in the selected period.").waitFor();
    }
    if (state === "gate" || state === "failure")
      assert.equal(await page.getByText("$1,234.56", { exact: true }).count(), 0);
    if (["stale", "unconfigured", "unavailable"].includes(state))
      await capture(`overview-${state}`);
  }
  mode = "ready";
  await page.getByRole("button", { name: "Retry report" }).click();
  await page.getByRole("region", { name: "Net product sales trend" }).waitFor();

  const exportButton = page.getByRole("button", { name: "Export CSV" });
  exportMode = "limit";
  await exportButton.click();
  await page
    .getByText("Choose a shorter date range or apply filters.", { exact: true })
    .waitFor();
  exportMode = "gate";
  await exportButton.click();
  await page
    .getByText("Admin access is required to export this report.", { exact: true })
    .waitFor();
  exportMode = "csv";
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportButton.click(),
  ]);
  assert.equal(download.suggestedFilename(), "sole-overview-2025-12-31-2026-01-01.csv");

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await capture(`overview-${width}`);
    if (width === 390) {
      await trend.getByText("View chart data").click();
      await trend.getByRole("cell", { name: "$1,234.56", exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      );
      const tableScroll = trend.getByRole("region", {
        name: "Net product sales by reporting interval",
      });
      assert.equal(
        await tableScroll.evaluate((el) => el.scrollWidth > el.clientWidth),
        true,
      );
      await capture("overview-chart-table-390");
    }
    await dateButton.click();
    assert.equal(await dialog.locator(".rdp-month").count(), width === 390 ? 1 : 2);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.equal(
      await dialog.evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await capture(`calendar-${width}`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }

  mode = "review-coverage";
  await page.setViewportSize({ width: 1440, height: 980 });
  const comparison = page.getByRole("checkbox", { name: "Compare previous period" });
  await comparison.uncheck();
  await dateButton.click();
  await start.fill("2026-10-27");
  await end.fill("2026-11-19");
  await apply.click();
  await page.getByLabel("Group by", { exact: true }).selectOption("week");

  async function assertPlotDates(priorCount) {
    const plot = trend.locator(".analytics-series-plot");
    await page.waitForFunction(
      (expectedPriorCount) =>
        document.querySelectorAll(".analytics-series-current circle").length === 4 &&
        document.querySelectorAll(".analytics-series-prior circle").length ===
          expectedPriorCount,
      priorCount,
    );
    const { dates, points } = await plot.evaluate((chart) => {
      const center = (element) => {
        const { left, width } = element.getBoundingClientRect();
        return left + width / 2;
      };
      return {
        dates: [...chart.querySelectorAll(".analytics-series-dates span")].map(
          (tick) => ({
            label: tick.textContent,
            x: center(tick),
          }),
        ),
        points: [...chart.querySelectorAll(".analytics-series-current circle")].map(
          center,
        ),
      };
    });
    assert.deepEqual(
      dates.map(({ label }) => label),
      ["Oct 27", "Nov 2", "Nov 16"],
    );
    for (const [tick, point] of [0, 1, 3].entries()) {
      assert.ok(
        Math.abs(dates[tick].x - points[point]) < 1,
        `${dates[tick].label} should be centered on bucket ${point + 1}`,
      );
    }
  }

  await assertPlotDates(0);
  await comparison.check();
  await assertPlotDates(5);
  assert.match(
    await trend.locator(".analytics-series-current circle title").first().textContent(),
    /^Selected period: Oct 27/,
  );
  await page
    .getByText("Previous period · $1,120.00 · 2 missing values", { exact: true })
    .waitFor();
  await page
    .getByText("Previous period · $157.73 · 1 missing value", { exact: true })
    .waitFor();
  await page
    .getByText("Confirmed orders without a recorded buyer", { exact: true })
    .waitFor();
  await capture("overview-weekly-uneven");

  assert.ok(requests.length >= 14);
  assert.deepEqual(pageErrors, []);
  console.log(
    "PASS: Overview navigation, date dialog, real range selection, store-local comparisons, history, request races, coverage, exports, chart tables, and responsive layouts",
  );
} finally {
  await browser.close();
}
