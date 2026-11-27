import type { ReactElement } from "react";

jest.mock("@/lib/auth/session", () => ({ requireAdmin: jest.fn() }));
jest.mock("../../../Source/Features/Reporting/report-runtime", () => ({
  loadServerReport: jest.fn(),
}));
jest.mock("../../../Source/Features/Dashboard/AnalyticsPageClient", () => ({
  AnalyticsPageClient: () => null,
}));

import Page from "@/app/admin/analytics/page";
import { requireAdmin } from "@/lib/auth/session";
import { loadServerReport } from "../../../Source/Features/Reporting/report-runtime";

const requireAdminMock = jest.mocked(requireAdmin);
const loadServerReportMock = jest.mocked(loadServerReport);
beforeEach(() => jest.resetAllMocks());

test("a rejected admin never reaches the analytics loader", async () => {
  requireAdminMock.mockRejectedValue(new Error("Unauthorized"));
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    "Unauthorized",
  );
  expect(loadServerReportMock).not.toHaveBeenCalled();
});

test("authorized pages pass the validated aggregate result and location to the client", async () => {
  requireAdminMock.mockResolvedValue({
    user: { id: "staff-row", email: "staff@example.test" },
    profile: null,
    role: "admin",
  });
  loadServerReportMock.mockImplementation((request, { deadline }) => {
    expect(requireAdminMock.mock.invocationCallOrder[0]).toBeLessThan(
      loadServerReportMock.mock.invocationCallOrder[0],
    );
    expect(deadline).toBeGreaterThan(performance.now());
    return Promise.resolve({
      state: "unconfigured",
      data: null,
      range: request.range,
      coverage: [],
      asOf: "2026-11-25T12:00:00.000Z",
      behaviorThrough: null,
      ingestionAsOf: null,
      datasetStartedAt: null,
      scope: {
        dataset: null,
        filters: {},
        dateBasis: request.dateBasis,
        attribution: {
          orderScope: "all-orders",
          eligibleOrders: null,
          attributedOrders: null,
          unattributedOrders: null,
        },
      },
    });
  });
  const result = (await Page({
    searchParams: Promise.resolve({
      report: "acquisition",
      from: "2024-02-29",
      to: "2024-02-29",
      attribution: "discovery",
    }),
  })) as ReactElement<{ initialRequest: unknown; initialReport: unknown }>;
  expect(Object.keys(result.props).sort()).toEqual(["initialReport", "initialRequest"]);
  expect(result.props.initialRequest).toMatchObject({
    attribution: "discovery",
    request: { report: "acquisition", range: { calendarDays: 1 } },
  });
  expect(result.props.initialReport).toMatchObject({ state: "unconfigured", data: null });
  expect(JSON.stringify(result.props)).not.toContain("staff@example.test");
});

test("duplicate URL fields do not produce provider work", async () => {
  requireAdminMock.mockResolvedValue({
    user: { id: "staff", email: "" },
    profile: null,
    role: "admin",
  });
  await Page({ searchParams: Promise.resolve({ report: ["overview", "sales"] }) });
  expect(loadServerReportMock).not.toHaveBeenCalled();
});
