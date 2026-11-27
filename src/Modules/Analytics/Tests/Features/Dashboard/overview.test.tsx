import { renderToStaticMarkup } from "react-dom/server";
import { OverviewReport } from "../../../Source/Features/Dashboard/reports/OverviewReport";
import { exportAnalyticsCsv } from "../../../Source/Features/Reporting/csv-export";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { makeAudienceFixture } from "../Reporting/audience-fixture";
import { request, sale } from "../Reporting/commerce-fixture";

jest.mock("server-only", () => ({}), { virtual: true });

test("recorded buyers and missing buyer-key orders remain independent in each period and CSV", async () => {
  const fixture = makeAudienceFixture();
  const prior = "2026-06-09T16:00:00.000Z";
  fixture.put("order", "selected-one", sale, { order: "selected-one", buyer: null });
  fixture.put("order", "selected-two", sale, { order: "selected-two", buyer: null });
  fixture.put("order", "prior-missing", sale, {
    order: "prior-missing",
    buyer: null,
    at: prior,
  });
  fixture.sale("prior-recorded", "buyer-known", prior);
  const req = { ...request("overview", "compare=true"), report: "overview" as const };
  const report = await getReport(req, fixture.deps);
  expect(report.data?.summary).toMatchObject({
    confirmedOrders: 2,
    buyers: 0,
    missingBuyerOrders: 2,
  });
  expect(report.data?.comparison).toMatchObject({
    confirmedOrders: 2,
    buyers: 1,
    missingBuyerOrders: 1,
  });

  const html = renderToStaticMarkup(<OverviewReport report={report} />);
  expect(html).toContain(
    "<dt>Recorded buyers</dt><dd>0<small>Previous period · 1</small>",
  );
  expect(html).toContain(
    "<dt>Confirmed orders without a recorded buyer</dt><dd>2<small>Previous period · 1</small>",
  );
  const { body } = exportAnalyticsCsv(report, req);
  expect(body).toContain('"report.data.summary.missingBuyerOrders","2","observed"');
  expect(body).toContain('"report.data.comparison.missingBuyerOrders","1","observed"');
});

test("Overview attaches each monetary KPI's independent comparison coverage to the previous value", async () => {
  const fixture = makeAudienceFixture();
  fixture.sale("selected", "buyer");
  fixture.sale("prior", "buyer", "2026-06-09T16:00:00.000Z");
  const report = await getReport(
    { ...request("overview", "compare=true"), report: "overview" },
    fixture.deps,
  );
  const { summary, comparison } = report.data!;
  expect(summary.netMerchandise.complete).toBe(true);
  expect(summary.averageOrderValue.complete).toBe(true);
  Object.assign(comparison!, {
    netMerchandise: { cents: 800, complete: false, missingCount: 2 },
    averageOrderValue: { cents: 825, complete: false, missingCount: 1 },
  });
  const html = renderToStaticMarkup(<OverviewReport report={report} />);
  expect(html).toContain("Previous period · $8.00 · 2 missing values");
  expect(html).toContain("Previous period · $8.25 · 1 missing value");
});
