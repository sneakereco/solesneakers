import assert from "node:assert/strict";
import { build } from "esbuild";

const query = (report, pageSize) =>
  new URLSearchParams({
    report,
    from: "2026-06-10",
    to: "2026-06-10",
    compare: "true",
    ...(pageSize ? { pageSize } : {}),
  });

export const paymentHealthQueries = {
  payments: query("payments", "2"),
  health: query("health"),
};

let producerFixture;
export async function paymentHealthFixture(report, params, mode) {
  producerFixture ??= build({
    entryPoints: [
      "src/Modules/Analytics/Tests/Features/Dashboard/payment-health-fixture.ts",
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "server-only-in-producer-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "producer-fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "producer-fixture" }, () => ({
            contents: "export {};",
          }));
        },
      },
    ],
  }).then(
    ({ outputFiles: [output] }) =>
      import(
        `data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`
      ),
  );
  const { loadPaymentHealthFixture } = await producerFixture;
  return (await loadPaymentHealthFixture(report, params, mode)).result;
}

async function checkMobileTables(page, content) {
  const regions = content
    .getByRole("region")
    .and(content.locator(".analytics-table-scroll"));
  assert.ok(await regions.count());
  let scrollable = 0;
  for (const region of await regions.all()) {
    assert.equal(await region.getAttribute("tabindex"), "0");
    const label = await region.getAttribute("aria-label");
    assert.ok(label);
    const geometry = await region.evaluate((node) => {
      const panel = node.closest(".analytics-panel").getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return {
        inside: box.left >= panel.left && box.right <= panel.right,
        overflows: node.scrollWidth > node.clientWidth,
      };
    });
    assert.ok(geometry.inside, `${label} extends beyond its report panel`);
    if (geometry.overflows) {
      scrollable++;
      await region.focus();
      assert.equal(
        await region.evaluate((node) => node === document.activeElement),
        true,
      );
      await region.press("ArrowRight");
      await page.waitForFunction(() => document.activeElement.scrollLeft > 0);
      await region.evaluate((node) => node.scrollTo({ left: 0, behavior: "instant" }));
    }
  }
  assert.ok(scrollable > 0);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
}

async function revealChart(panel) {
  await panel.getByText("View chart data", { exact: true }).first().click();
}

async function runPayments({ page, requests, capture, setMode }) {
  const content = page.locator(".analytics-page");
  await page.getByRole("heading", { name: "Paid-order popularity" }).waitFor();
  const attempts = page.getByRole("region", { name: "Payment attempts", exact: true });
  const card = attempts
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: "Card", exact: true }) });
  for (const rate of ["88.9% (96 / 108)", "11.1% (12 / 108)", "1.8% (2 / 110)"])
    await card.getByText(rate, { exact: true }).waitFor();
  const rank = content.locator(".analytics-panel").filter({
    has: page.getByRole("heading", { name: "Paid-order popularity" }),
  });
  await revealChart(rank);
  await rank.getByRole("table").getByText("40% (96 / 240)", { exact: true }).waitFor();
  await revealChart(
    content.locator(".analytics-panel").filter({
      has: page.getByRole("heading", { name: "Payment attempts", exact: true }),
    }),
  );
  await page
    .getByRole("table", { name: "Attempt success rates on this page" })
    .getByText("88.9% (96 / 108)", { exact: true })
    .waitFor();
  await page
    .locator("summary")
    .filter({ hasText: /^Previous period payment attempts$/ })
    .click();
  const prior = page.getByRole("region", { name: "Previous period payment attempts" });
  await prior.getByRole("rowheader", { name: "Google Pay" }).waitFor();
  assert.equal(
    await prior.getByRole("rowheader", { name: "Card", exact: true }).count(),
    0,
  );
  await page
    .locator("summary")
    .filter({ hasText: /^Previous period payment amounts$/ })
    .click();
  await capture("payments-desktop-open");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("payments-mobile-open");
  await checkMobileTables(page, content);
  await page.setViewportSize({ width: 1440, height: 980 });

  const money = page.getByRole("region", { name: "Payment amounts", exact: true });
  const pager = page.getByRole("navigation", { name: "Payment method pages" });
  await pager.getByRole("button", { name: "Next page" }).click();
  await money.getByRole("rowheader", { name: "Google Pay" }).waitFor();
  await money.getByText("$0.00", { exact: true }).waitFor();
  assert.equal(requests.at(-1).searchParams.get("page"), "2");
  await pager.getByRole("button", { name: "Next page" }).click();
  await money.getByRole("rowheader", { name: "Unknown method" }).waitFor();
  await money.getByRole("rowheader", { name: "Cash App Pay" }).waitFor();
  await capture("payments-unknown-method");

  await page.getByLabel("Rank by").selectOption("revenue");
  await money.getByRole("rowheader", { name: "Card", exact: true }).waitFor();
  assert.equal(requests.at(-1).searchParams.get("page"), "1");
  assert.equal(requests.at(-1).searchParams.get("sort"), "revenue");
  await card.getByText("88.9% (96 / 108)", { exact: true }).waitFor();
  await page.getByLabel("Date basis").selectOption("order-cohort");
  await card.getByText("100% (96 / 96)", { exact: true }).waitFor();

  setMode("provider-outage");
  await page.getByLabel("Date basis").selectOption("activity");
  await page.getByText("This report is unavailable.", { exact: true }).waitFor();
  assert.equal(await money.count(), 0);
  await capture("payments-provider-outage");
  setMode("ready");
  await page.getByRole("button", { name: "Retry report" }).click();
  await card.getByText("88.9% (96 / 108)", { exact: true }).waitFor();
  setMode("reconciled");
  await page.getByLabel("Rank by").selectOption("paidOrders");
  await card.getByText("88.1% (96 / 109)", { exact: true }).waitFor();
  await card.getByText("0.9% (1 / 110)", { exact: true }).waitFor();

  setMode("ready");
  await page.getByRole("button", { name: /^Date range/ }).click();
  const calendar = page.getByRole("dialog", { name: "Choose a date range" });
  await calendar.getByLabel("Start date").fill("2026-06-08");
  await calendar.getByLabel("End date").fill("2026-06-08");
  await calendar.getByRole("button", { name: "Apply range" }).click();
  await page
    .getByText("No payment method activity recorded for the selected period.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await money.count(), 0);
  assert.equal(await page.getByRole("rowheader", { name: "Unknown method" }).count(), 0);
  console.log(
    "PASS: payment denominators, independent prior page, six methods, exact fees, sort, scope, provider recovery, reconciliation, and zero-balance completion",
  );
}

async function runHealth({ page, requests, capture, setMode }) {
  const content = page.locator(".analytics-page");
  await page.getByRole("heading", { name: "Same-session checkout funnel" }).waitFor();
  const panel = content.locator(".analytics-panel").filter({
    has: page.getByRole("heading", { name: "Same-session checkout funnel" }),
  });
  await revealChart(panel);
  await panel.getByRole("rowheader", { name: "Purchased" }).waitFor();
  const outcomes = page.getByRole("region", {
    name: "Recorded operational outcomes",
    exact: true,
  });
  await outcomes.getByRole("cell", { name: "Expired" }).waitFor();
  await outcomes.getByRole("cell", { name: "Unknown" }).waitFor();
  const states = page.getByRole("region", {
    name: "Latest recorded fulfillment states",
    exact: true,
  });
  await states.getByRole("cell", { name: "Open", exact: true }).waitFor();
  await states.getByRole("cell", { name: "Shipped", exact: true }).waitFor();
  await revealChart(
    content.locator(".analytics-panel").filter({
      has: page.getByRole("heading", { name: "Fulfillment and backlog", exact: true }),
    }),
  );
  const preference = page.getByRole("table", {
    name: "Fulfillment preference shares",
    exact: true,
  });
  const unknownPreference = preference.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: "Unknown preference" }),
  });
  await unknownPreference.getByRole("cell", { name: "25%" }).waitFor();
  await unknownPreference.getByRole("cell", { name: "4", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Open Shipping" }).getAttribute("href"),
    "/admin/shipping",
  );
  assert.equal(
    await page.getByRole("link", { name: "Open Pickups" }).getAttribute("href"),
    "/admin/pickups",
  );
  await page
    .locator("summary")
    .filter({ hasText: /^Previous period fulfillment$/ })
    .click();
  await page
    .getByRole("region", { name: "Previous period latest recorded fulfillment states" })
    .getByRole("cell", { name: "Status unknown", exact: true })
    .waitFor();
  await capture("checkout-health-desktop-open");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("checkout-health-mobile-open");
  await checkMobileTables(page, content);
  await page.setViewportSize({ width: 1440, height: 980 });

  await page.getByLabel("Payment method").selectOption("card");
  await page
    .getByText(/Visitor and session activity retain their behavioral scope/)
    .waitFor();
  assert.equal(requests.at(-1).searchParams.get("paymentMethod"), "card");
  assert.equal(await outcomes.getByRole("cell", { name: "Expired" }).count(), 0);
  assert.equal(await panel.getByRole("region", { name: "Shopping funnel" }).count(), 1);

  setMode("traffic-outage");
  await page.getByLabel("Payment method").selectOption("");
  await panel
    .locator(":scope > p")
    .filter({ hasText: /^Same-session funnel unavailable for this period\.$/ })
    .waitFor();
  await outcomes.getByRole("cell", { name: "Expired" }).waitFor();
  await states.getByRole("cell", { name: "Shipped", exact: true }).waitFor();
  await capture("checkout-health-traffic-outage");
  console.log(
    "PASS: consented funnel, overlapping outcomes, fulfillment states, mobile overflow, filters, and partial outage",
  );
}

export const paymentHealthScenarios = { payments: runPayments, health: runHealth };
