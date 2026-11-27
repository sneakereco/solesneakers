import { renderToStaticMarkup } from "react-dom/server";
import { AnalyticsPageClient } from "../../../Source/Features/Dashboard/AnalyticsPageClient";
import { loadPaymentHealthFixture, type FixtureMode } from "./payment-health-fixture";

jest.mock("server-only", () => ({}), { virtual: true });

async function render(
  report: "payments" | "health",
  extra = "",
  mode: FixtureMode = "ready",
) {
  const params = new URLSearchParams({ report, from: "2026-06-10", to: "2026-06-10" });
  for (const [key, value] of new URLSearchParams(extra)) params.set(key, value);
  const { request, result } = await loadPaymentHealthFixture(report, params, mode);
  return renderToStaticMarkup(
    <AnalyticsPageClient
      initialRequest={{ request, attribution: "purchase-session" }}
      initialReport={result}
    />,
  );
}

test("shows the full paid-order and resolved-attempt denominators on the visible method page", async () => {
  const html = await render("payments", "pageSize=1&compare=true");
  expect(html).toContain("40% (96 / 240)");
  expect(html).toContain("88.9% (96 / 108)");
  expect(html).toContain("11.1% (12 / 108)");
  expect(html).toContain("1.8% (2 / 110)");
  expect(html).toContain("Pending or unresolved");
  const successChart = html.match(
    /aria-label="Attempt success rates on this page".*?<\/section>/,
  )?.[0];
  expect(Number(successChart?.match(/\bwidth:([\d.]+)%/)?.[1])).toBeCloseTo(88.89, 2);
  expect(successChart).toContain("<strong>88.9% (96 / 108)</strong>");
  expect(html).toContain("Previous period payment attempts");
  expect(html).toMatch(/Previous period attribution.*1 of 3 attributed.*2 unattributed/);
});

test("renders real zero fees, incomplete fees, absent fees and every observed method", async () => {
  const html = await render("payments");
  for (const name of [
    "Card",
    "Apple Pay",
    "Google Pay",
    "Afterpay",
    "Cash App Pay",
    "Unknown method",
  ])
    expect(html).toContain(`<th scope="row">${name}</th>`);
  expect(html).toMatch(
    /<th scope="row">Card<\/th><td>\$960\.96<\/td><td>\$10\.01<\/td><td>Unavailable<small>96 missing values/,
  );
  expect(html).toMatch(
    /<th scope="row">Apple Pay<\/th><td>\$1,830\.00<\/td><td>\$30\.50<\/td><td>\$0\.75<small>59 missing values/,
  );
  expect(html).toContain(
    '<th scope="row">Google Pay</th><td>$400.00</td><td>$10.00</td><td>$0.00</td>',
  );
  expect(html).not.toMatch(/<th scope="row">Zero.balance/i);
  expect(await render("payments", "dateBasis=order-cohort")).toContain("100% (96 / 96)");
  const zero = await render("payments", "from=2026-06-08&to=2026-06-08");
  expect(zero).toContain("No payment method activity recorded for the selected period.");
  expect(zero).toContain("No payment method groups for this period.");
  expect(zero).toContain("0 of 1 attributed · 1 unattributed");
});

test("keeps session evidence and overlapping operational outcomes independent", async () => {
  const html = await render("health", "paymentMethod=card&compare=true");
  expect(html).toContain("Same-session checkout funnel");
  expect(html).toContain("Visitor and session activity retain their behavioral scope.");
  expect(html).toContain('<th scope="row">Purchased</th><td>1</td>');
  expect(html).toContain("Checkout completion");
  expect(html).toContain("50% (1 / 2)");
  expect(html).toContain("Counts can overlap across stages and reasons.");
  expect(html).toContain(
    '<th scope="row">Payment</th><td>Unknown</td><td>Timeout</td><td>1</td>',
  );
  expect(html).not.toContain('<th scope="row">Checkout</th><td>Failed</td>');
  expect(html).not.toContain('<th scope="row">Reservation</th><td>Expired</td>');
  const unfiltered = await render("health");
  expect(unfiltered).toContain(
    '<th scope="row">Reservation</th><td>Expired</td><td>Inventory</td><td>1</td>',
  );
  expect(unfiltered).toContain(
    '<th scope="row">Checkout</th><td>Failed</td><td>Timeout</td><td>1</td>',
  );
  expect(unfiltered).toContain(
    '<th scope="row">Payment</th><td>Unknown</td><td>Timeout</td><td>1</td>',
  );
});

test("reports the latest fulfillment states and recorded duration with honest age coverage", async () => {
  const html = await render("health", "dateBasis=activity&compare=true");
  expect(html).toContain("Originally confirmed Jun 10, 2026");
  expect(html).toContain("Warehouse observed through");
  expect(html).toContain("Backlog age unavailable");
  const preference = html.match(
    /aria-label="Fulfillment preference shares".*?<\/section>/,
  )?.[0];
  expect(preference).toContain(
    '<th scope="row">Shipping</th><td>25%</td><td>1</td><td>4</td>',
  );
  expect(preference).toContain(
    '<th scope="row">Pickup</th><td>50%</td><td>2</td><td>4</td>',
  );
  expect(preference).toContain(
    '<th scope="row">Unknown preference</th><td>25%</td><td>1</td><td>4</td>',
  );
  expect(html).toContain(
    '<th scope="row">Pickup</th><td>Processing</td><td>Open</td><td>1</td>',
  );
  expect(html).toContain(
    '<th scope="row">Shipping</th><td>Shipped</td><td>Fulfillment recorded</td><td>1</td>',
  );
  expect(html).toContain(
    '<th scope="row">Shipping</th><td>1</td><td>25h 1m 5s</td><td>25h 1m 5s</td>',
  );
  expect(html).toContain("1 order without a recorded fulfillment state");
  expect(html).toContain("1 fulfilled order without usable duration evidence");
  expect(html).toMatch(/Previous period attribution.*0 of 1 attributed.*1 unattributed/);
  expect(html).toContain('href="/admin/shipping"');
  expect(html).toContain('href="/admin/pickups"');
});

test("keeps operational evidence visible when the consented provider section is unavailable", async () => {
  const html = await render("health", "compare=true", "traffic-outage");
  expect(html).toContain("Same-session funnel unavailable for this period.");
  expect(html).toContain("Checkout completion unavailable for this period.");
  expect(html).toContain(
    '<th scope="row">Reservation</th><td>Expired</td><td>Inventory</td><td>1</td>',
  );
  const unavailable = await render("payments", "", "provider-outage");
  expect(unavailable).toContain("This report is unavailable.");
  expect(unavailable).not.toContain("Paid orders with a positive balance");
});
