import { renderToStaticMarkup } from "react-dom/server";
import type {
  ReportEnvelope,
  SalesData,
} from "../../../Source/Features/ReportContract/types";
import { SalesReport } from "../../../Source/Features/Dashboard/reports/SalesReport";
import { exportAnalyticsCsv } from "../../../Source/Features/Reporting/csv-export";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { makeAudienceFixture } from "../Reporting/audience-fixture";
import { line, refund, request, sale } from "../Reporting/commerce-fixture";

jest.mock("server-only", () => ({}), { virtual: true });

const june9 = "2026-06-09T16:00:00.000Z";
const june11 = "2026-06-11T16:00:00.000Z";
const render = (report: ReportEnvelope<SalesData>) =>
  renderToStaticMarkup(<SalesReport report={report} onRequestChange={jest.fn()} />);

function saleRequest(extra = "") {
  return { ...request("sales", extra), report: "sales" as const };
}

test("renders the verified waterfall, original order values and the same scoped CSV totals", async () => {
  const f = makeAudienceFixture();
  f.put("order", "o", sale);
  f.put("line", "l", line);
  f.put("refund", "r", refund);
  f.put("refund", "r", refund, { revision: 2 });
  f.put("refund", "pending", { ...refund, status: "pending" });
  const req = saleRequest("page=4&pageSize=1");
  const report = await getReport(req, f.deps);
  const html = render(report);
  expect(html).toContain('aria-label="Collected revenue waterfall"><ol');
  expect(html).toContain('<th scope="row">Total collected, net</th><td>$47,322.00</td>');
  expect(html).toContain('<th scope="row">Product refunds</th><td>-$900.00</td>');
  expect(html).toContain('<th scope="row">$1,000.00 and up</th><td>1</td>');
  expect(html).toMatch(/<h2>Average order value<\/h2><p[^>]*>\$43,200\.00<\/p>/);
  expect(html).toContain("<dt>Median order value</dt><dd>$43,200.00");
  expect(html).toContain("<dt>Orders with unavailable values</dt><dd>0");

  const { body } = exportAnalyticsCsv(report, req);
  expect(body).toContain('"report.data.totalCollected.cents","4732200","observed"');
  expect(body).toContain('"report.data.merchandiseRefunds.cents","90000","observed"');
  expect(body).toContain(
    '"report.data.orderValueBins[5].confirmedOrders","1","observed"',
  );
});

test("keeps refund timing, unallocated deductions, and unassigned quantities explicit across date bases", async () => {
  const f = makeAudienceFixture();
  f.put("order", "original", sale, { at: june9 });
  f.put("line", "original-line", line, { at: june9 });
  f.put("refund", "unallocated", {
    ...refund,
    totalCents: 10_001,
    merchandiseCents: null,
    shippingCents: null,
    taxCents: null,
    unallocatedCents: 10_001,
  });
  const activity = render(await getReport(saleRequest(), f.deps));
  expect(activity).toContain("Completed refunds are shown on their completion dates");
  expect(activity).toContain("Coverage is incomplete for the full waterfall");
  expect(
    activity.match(/<th scope="row">Unallocated refunds<\/th><td>-\$100\.01<\/td>/g),
  ).toHaveLength(1);
  expect(activity).toContain(
    '<th scope="row">Total collected, net</th><td>-$100.01</td>',
  );
  expect(activity).toContain(
    "<dt>Refunds or return lines with missing quantities</dt><dd>1",
  );

  f.put("order", "cohort", sale, { order: "cohort" });
  f.put("line", "cohort-line", line, { order: "cohort" });
  f.put("refund", "later", refund, { at: june11, order: "cohort" });
  const cohort = render(await getReport(saleRequest("dateBasis=order-cohort"), f.deps));
  expect(cohort).toContain(
    "Orders confirmed in the selected dates include subsequent completed refunds observed so far",
  );
  expect(cohort).toContain('<th scope="row">Product refunds</th><td>-$900.00</td>');
  expect(cohort).toContain(
    '<th scope="row">Total collected, net</th><td>$47,322.00</td>',
  );
});

test("renders known zero costs, independent prior coverage, and original-order coverage denominators", async () => {
  const f = makeAudienceFixture();
  f.put("order", "zero", sale, { order: "zero" });
  f.put("line", "zero-line", { ...line, unitCostCents: 0 }, { order: "zero" });
  f.put("fee", "zero-fee", { adjustment: "charge", amountCents: 0 }, { order: "zero" });
  f.put(
    "shipping_cost",
    "zero-label",
    { adjustment: "charge", amountCents: 0 },
    { order: "zero" },
  );
  f.put("order", "prior", sale, { at: june9, order: "prior" });
  f.put(
    "line",
    "missing-cost",
    { ...line, unitCostCents: null },
    { at: june9, order: "prior" },
  );
  const missing = render(await getReport(saleRequest("compare=true"), f.deps));
  expect(missing).toContain(
    "<dt>Recorded product cost</dt><dd>$0.00<small>Previous period · Unavailable · 1 missing value</small>",
  );
  expect(missing).toContain(
    "<dt>Recorded payment fees</dt><dd>$0.00<small>Previous period · Unavailable · 1 missing value</small>",
  );
  expect(missing).toContain(
    "<dt>Recorded shipping contribution</dt><dd>$1,800.00<small>Previous period · Unavailable · 1 missing value</small>",
  );
  expect(missing).toContain(
    "<dt>Gross product profit</dt><dd>$43,200.00<small>Previous period · Unavailable · 1 missing value</small>",
  );
  expect(missing).toContain(
    "Excludes shipping, taxes, payment fees, and operating expenses.",
  );

  f.put("order", "missing", sale, { order: "missing" });
  f.put("line", "missing-line", { ...line, unitCostCents: null }, { order: "missing" });
  const partial = render(await getReport(saleRequest("compare=true"), f.deps));
  expect(partial).toContain(
    "<dt>Recorded product cost</dt><dd>$0.00<small>1 missing value</small>",
  );
  expect(partial).toContain(
    '<th scope="row">Product revenue</th><td>50%<small>$43,200.00 / $86,400.00</small></td><td>0%<small>$0.00 / $43,200.00</small></td>',
  );
  expect(partial).toContain(
    '<th scope="row">Confirmed orders</th><td>50%<small>1 / 2</small></td><td>0%<small>0 / 1</small></td>',
  );
  expect(partial).toContain(
    '<th scope="row">Original product lines</th><td>50%<small>1 / 2</small></td><td>0%<small>0 / 1</small></td>',
  );
});

test("shows exact integer cents and unavailable comparison coverage independently", async () => {
  const f = makeAudienceFixture();
  f.put("order", "o", sale);
  f.put("line", "l", line);
  f.put("order", "prior", sale, { at: june9, order: "prior" });
  const report = await getReport(saleRequest("compare=true"), f.deps);
  if (!report.data?.comparison) throw new Error("Expected both Sales periods");
  report.data.netMerchandise = {
    cents: Number.MAX_SAFE_INTEGER,
    complete: true,
    missingCount: 0,
  };
  report.data.comparison.netMerchandise = {
    cents: -Number.MAX_SAFE_INTEGER,
    complete: false,
    missingCount: 2,
  };
  expect(render(report)).toMatch(
    /<h2>Net product sales<\/h2><p[^>]*>\$90,071,992,547,409\.91<\/p><p[^>]*>Previous period · -\$90,071,992,547,409\.91 · 2 missing values<\/p>/,
  );
  report.data.comparison = null;
  expect(render(report)).toMatch(
    /<h2>Net product sales<\/h2><p[^>]*>\$90,071,992,547,409\.91<\/p><p[^>]*>Previous period · Unavailable<\/p>/,
  );
});
