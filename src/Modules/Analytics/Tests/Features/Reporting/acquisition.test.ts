import {
  parseReportLocation,
  parseReportRequest,
} from "../../../Source/Features/ReportContract/filters";
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
  expect(r.data?.purchaseSession).toMatchObject({
    sources: { rows: [], totalCount: 0 },
    channels: { rows: [], totalCount: 0 },
    campaigns: { rows: [], totalCount: 0 },
    placements: { rows: [], totalCount: 0 },
  });
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
  for (const view of ["discovery", "purchaseSession"] as const) {
    expect(paged.data?.[view]).toMatchObject({
      sources: { rows: [], totalCount: 2 },
      channels: { rows: [], totalCount: 2 },
      campaigns: { rows: [], totalCount: 2 },
      placements: { rows: [], totalCount: 2 },
    });
  }
});
it("review: counts a legitimate purchasing session despite a later out-of-session purchase", async () => {
  const f = makeAudienceFixture();
  f.event(1, "public_page_viewed");
  for (const [o, at] of [
    ["valid", "2026-06-10T13:00:00.000Z"],
    ["late", "2026-06-11T13:00:00.000Z"],
  ]) {
    f.sale(o, "guest", at);
    f.link(o, 1, at);
  }
  const req = { ...request("acquisition"), report: "acquisition" as const };
  const { range } = parseReportRequest(
    new URLSearchParams("report=acquisition&from=2026-06-10&to=2026-06-11"),
    f.deps.now,
  );
  const r = await getReport({ ...req, range }, f.deps);
  for (const view of ["discovery", "purchaseSession"] as const)
    expect(r.data?.[view].sources.rows[0]).toMatchObject({
      sessions: 1,
      confirmedOrders: 2,
      purchasingSessions: 1,
    });
});
it("review: selects unknown campaign and device for observed sessions and linked orders", async () => {
  const f = makeAudienceFixture();
  f.event(1, "public_page_viewed");
  f.sale("o", "guest");
  f.sale("unlinked", "guest");
  f.link("o", 1);
  f.db.exec(
    "update events set properties=json_remove(properties,'$.device');update analytics_purchase_link_export set device=NULL",
  );
  const r = await getReport(
    {
      ...request("acquisition", "campaign=unknown&device=unknown"),
      report: "acquisition",
    },
    f.deps,
  );
  for (const view of ["discovery", "purchaseSession"] as const) {
    expect(r.data?.[view].campaigns.rows).toEqual([
      expect.objectContaining({ key: "unknown", sessions: 1, confirmedOrders: 1 }),
    ]);
    expect(r.data?.[view].attribution).toEqual({
      eligibleOrders: 2,
      attributedOrders: 1,
    });
  }
  const customers = await getReport(
    { ...request("customers", "device=unknown"), report: "customers" },
    f.deps,
  );
  expect(customers.data?.devices?.rows).toEqual([
    { device: "unknown", sessions: 1, visitors: 1 },
  ]);
});
it.each(["sole_analytics_acquisition", "sole_analytics_acquisition_series"])(
  "review: rejects null known wire money from %s",
  async (endpoint) => {
    const f = makeAudienceFixture();
    f.sale("o", "guest");
    const r = await getReport(
      { ...request("acquisition"), report: "acquisition" },
      {
        ...f.deps,
        execute: async (q) => {
          const wire = await f.execute(q);
          if (q.endpoint === endpoint)
            for (const row of wire.results)
              row[wire.columns.indexOf(endpoint.endsWith("series") ? "net" : "revenue")] =
                null;
          return wire;
        },
      },
    );
    expect(r.state).toBe("unavailable");
  },
);
