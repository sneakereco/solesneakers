import { parseReportLocation } from "../../../Source/Features/ReportContract/filters";
import { request } from "./commerce-fixture";
import { makeAudienceFixture } from "./audience-fixture";
import { getReport } from "../../../Source/Features/Reporting/report-service";
it("projects the acquisition URL selector out of the API scope", () => {
  const params = new URLSearchParams(
    "report=acquisition&attribution=discovery&source=instagram",
  );
  const result = parseReportLocation(params, new Date("2026-06-10"));
  expect(result.attribution).toBe("discovery");
  expect(result.apiParams.toString()).toBe("report=acquisition&source=instagram");
  params.append("attribution", "purchase-session");
  expect(() => parseReportLocation(params, new Date())).toThrow();
  expect(
    parseReportLocation(new URLSearchParams("report=acquisition"), new Date())
      .attribution,
  ).toBe("purchase-session");
});
it("uses view-specific filters and ignores unverified traffic when ranking financials", async () => {
  const f = makeAudienceFixture();
  f.journey();
  f.sale("guest", "guest");
  const req = {
    ...request("acquisition", "source=instagram"),
    report: "acquisition" as const,
  };
  const r = await getReport(req, f.deps);
  expect(r.data?.discovery.sources.rows[0]).toMatchObject({
    key: "instagram",
    sessions: 2,
    confirmedOrders: 1,
  });
  expect(r.data?.purchaseSession.sources.totalCount).toBe(0);
  expect(r.data?.discovery.attribution).toEqual({
    eligibleOrders: 2,
    attributedOrders: 1,
  });
  const gap = await getReport(
    { ...request("acquisition"), report: "acquisition" },
    { ...f.deps, history: { native: [], archive: [], observation: null } },
  );
  expect(
    gap.data?.purchaseSession.sources.rows.every((row) => row.sessions === null),
  ).toBe(true);
});
it("supplies independent previous dates and totals for acquisition", async () => {
  const f = makeAudienceFixture();
  f.journey();
  f.sale("prior", "old", "2026-06-09T12:00:00.000Z");
  const r = await getReport(
    { ...request("acquisition", "compare=true"), report: "acquisition" },
    f.deps,
  );
  expect(r.data?.comparison?.purchaseSession.sources.rows).toEqual([
    expect.objectContaining({ key: "unattributed", confirmedOrders: 1 }),
  ]);
});
it("keeps discovery and the purchase session distinct, including unattributed guest sales", async () => {
  const f = makeAudienceFixture();
  f.journey();
  f.sale("unlinked", "guest");
  const r = await getReport({ ...request("acquisition"), report: "acquisition" }, f.deps);
  expect(r.data?.discovery.sources.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "instagram", confirmedOrders: 1 }),
    ]),
  );
  expect(r.data?.purchaseSession.sources.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "google", confirmedOrders: 1 }),
      expect.objectContaining({ key: "unattributed", confirmedOrders: 1 }),
    ]),
  );
  const paged = await getReport(
    { ...request("acquisition", "page=100&pageSize=1"), report: "acquisition" },
    f.deps,
  );
  expect(paged.data?.purchaseSession.sources).toMatchObject({
    rows: [],
    totalCount: r.data?.purchaseSession.sources.totalCount,
  });
});
