import { renderToStaticMarkup } from "react-dom/server";
import { CohortHeatmap } from "../../../Source/Features/Dashboard/charts/CohortHeatmap";
import { TimeSeriesChart } from "../../../Source/Features/Dashboard/charts/TimeSeriesChart";
import {
  Histogram,
  StackedShares,
  Waterfall,
} from "../../../Source/Features/Dashboard/charts/ComparisonCharts";
import { readCohorts } from "../../../Source/Features/Reporting/queries/visitors";

jest.mock("server-only", () => ({}), { virtual: true });

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

test("complete twelve-slot cohort rows distinguish future cells from observed zero and elapsed rates without a denominator", () => {
  const cohorts = readCohorts(
    {
      columns: ["cohort", "age", "buyers", "repeaters"],
      results: [
        ["2026-09", 0, 2, 0],
        ["2026-10", 0, 0, 0],
      ],
      hasMore: false,
    },
    new Date("2026-11-25T17:00:00.000Z"),
  );
  const html = renderToStaticMarkup(<CohortHeatmap cohorts={cohorts} />);
  expect(cohorts.map(({ repeatPurchases }) => repeatPurchases.length)).toEqual([12, 12]);
  expect(html).toContain("Month 11");
  expect(html).toContain("0% (0 / 2)");
  expect(html.match(/Unavailable/g)).toHaveLength(1);
  expect(html.match(/aria-label="Not elapsed">—/g)).toHaveLength(21);
});

test("an unavailable cohort section shows its own message", () => {
  const html = renderToStaticMarkup(<CohortHeatmap cohorts={null} />);
  expect(html).toContain("Cohort activity is unavailable.");
  expect(html).not.toContain("<table");
});

test.each([
  ["four buckets", 0, 202, 594],
  ["five preceding buckets", 5, 153, 447],
])(
  "date ticks share the plotted positions with %s",
  (_case, priorSize, secondX, fourthX) => {
    const bucket = (day: number, month: string) => ({
      startInclusive: `2026-${month}-${String(day).padStart(2, "0")}T12:00:00Z`,
      endExclusive: `2026-${month}-${String(day + 1).padStart(2, "0")}T12:00:00Z`,
      netMerchandise: money(100 * day),
      confirmedOrders: day,
      sessions: null,
      visitors: null,
    });
    const html = renderToStaticMarkup(
      <TimeSeriesChart
        buckets={[1, 2, 3, 4].map((day) => bucket(day, "11"))}
        comparison={priorSize ? [1, 2, 3, 4, 5].map((day) => bucket(day, "10")) : null}
        unit="netMerchandise"
      />,
    );
    const ticks = new Map(
      [...html.matchAll(/<span style="left:([\d.]+)%">(Nov \d)<\/span>/g)].map(
        ([, percent, label]) => [label, Number(percent)],
      ),
    );
    expect(ticks.get("Nov 2")).toBeCloseTo((secondX * 100) / 600);
    expect(ticks.get("Nov 4")).toBeCloseTo((fourthX * 100) / 600);
    expect(html).toMatch(/<title>Selected period: [^<]+ · \$1\.00<\/title>/);
  },
);
