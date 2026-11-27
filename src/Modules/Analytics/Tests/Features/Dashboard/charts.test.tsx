import { renderToStaticMarkup } from "react-dom/server";
import { CohortHeatmap } from "../../../Source/Features/Dashboard/charts/CohortHeatmap";
import {
  Histogram,
  StackedShares,
  Waterfall,
} from "../../../Source/Features/Dashboard/charts/ComparisonCharts";

const money = (cents: number | null) => ({
  cents,
  complete: cents !== null,
  missingCount: cents === null ? 1 : 0,
});

test("waterfall exposes unallocated refunds once and never substitutes its visual sum for collected net", () => {
  const html = renderToStaticMarkup(
    <Waterfall
      components={{
        grossMerchandise: money(10_000),
        discounts: money(1_000),
        merchandiseRefunds: money(2_000),
        shippingCollected: money(900),
        shippingRefunds: money(0),
        taxCollected: money(1_000),
        taxRefunds: money(0),
        unallocatedRefunds: money(1_500),
        netMerchandise: money(7_000),
        netShipping: money(900),
        netTax: money(1_000),
        totalCollected: money(7_400),
      }}
    />,
  );
  const table = html.slice(html.indexOf("<table"));
  expect(table.match(/Unallocated refunds/g)).toHaveLength(1);
  expect(table).toContain("-$15.00");
  expect(table).toContain("$74.00");
});

test("histogram preserves zero counts and an open top bucket", () => {
  const html = renderToStaticMarkup(
    <Histogram
      bins={[
        { minimumCents: 0, maximumCentsExclusive: 5_000, confirmedOrders: 0 },
        { minimumCents: 5_000, maximumCentsExclusive: null, confirmedOrders: 3 },
      ]}
    />,
  );
  expect(html).toContain("$50.00 and up");
  expect(html).toContain("<td>0</td>");
  expect(html).toContain("<td>3</td>");
});

test("share charts use supplied fractions and keep unknown shares explicit", () => {
  const html = renderToStaticMarkup(
    <StackedShares
      rows={[
        {
          key: "card",
          label: "Card",
          share: { numerator: 96, denominator: 240, value: 0.4 },
        },
        {
          key: "unknown",
          label: "Unknown method",
          share: { numerator: null, denominator: 240, value: null },
        },
      ]}
    />,
  );
  expect(html).toContain("<td>40%</td>");
  expect(html).toContain("<td>240</td>");
  expect(html).toContain("<td>Unavailable</td>");
});

test("cohorts distinguish observed zero, unavailable and unelapsed cells", () => {
  const html = renderToStaticMarkup(
    <CohortHeatmap
      cohorts={[
        {
          month: "2026-10",
          buyers: 2,
          repeatPurchases: [
            {
              monthsSinceFirstPurchase: 0,
              repeatPurchaseRate: { numerator: 0, denominator: 2, value: 0 },
            },
            {
              monthsSinceFirstPurchase: 1,
              repeatPurchaseRate: { numerator: null, denominator: 2, value: null },
            },
          ],
        },
        {
          month: "2026-11",
          buyers: 3,
          repeatPurchases: [
            {
              monthsSinceFirstPurchase: 0,
              repeatPurchaseRate: { numerator: 1, denominator: 3, value: 1 / 3 },
            },
          ],
        },
      ]}
    />,
  );
  expect(html).toContain("0% (0 / 2)");
  expect(html).toContain("Unavailable");
  expect(html).toContain('aria-label="Not elapsed">—');
});
