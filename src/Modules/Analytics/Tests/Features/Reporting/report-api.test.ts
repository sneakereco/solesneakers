import { GET as json } from "@/app/api/admin/analytics/[report]/route";
import { GET as csv } from "@/app/api/admin/analytics/[report]/export/route";
import { AuthError, requireAdminApi } from "@/lib/auth/session";
import { loadServerReport } from "../../../Source/Features/Reporting/report-runtime";
import { request } from "./commerce-fixture";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { makeAudienceFixture } from "./audience-fixture";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/session", () => ({
  AuthError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  requireAdminApi: jest.fn(),
}));
jest.mock("../../../Source/Features/Reporting/report-runtime", () => ({
  loadServerReport: jest.fn(),
}));
const load = jest.mocked(loadServerReport);
const call = (handler: typeof json, report: string, query = "") =>
  handler(new Request("https://store.test/api/admin/analytics/" + report + "?" + query), {
    params: Promise.resolve({ report }),
  });
beforeEach(() => jest.clearAllMocks());
test.each([json, csv])(
  "requires admin authorization before loading either representation",
  async (handler) => {
    for (const status of [401, 403]) {
      jest
        .mocked(requireAdminApi)
        .mockRejectedValueOnce(new AuthError("private-fixture", status));
      const res = await call(handler, "payments");
      expect(res.status).toBe(status);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await res.text()).not.toContain("private-fixture");
    }
    expect(load).not.toHaveBeenCalled();
  },
);
test.each([
  "sql=select",
  "project=123",
  "host=private-fixture",
  "financialSource=events",
  "attribution=discovery",
  "report=products",
  "source=a&source=b",
])("rejects unsafe or mismatched API parameters %s", async (query) => {
  const res = await call(json, "sales", query);
  expect(res.status).toBe(400);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(load).not.toHaveBeenCalled();
});
test("returns an envelope and matching complete aggregate export independent of visible page", async () => {
  const f = makeAudienceFixture();
  load.mockImplementation((r) => getReport(r, f.deps));
  const q = "report=payments&from=2026-06-10&to=2026-06-10&page=2&pageSize=1";
  const a = await call(json, "payments", q);
  expect(a.status).toBe(200);
  expect(await a.json()).toMatchObject({
    state: "empty",
    range: request("payments").range,
  });
  const b = await call(csv, "payments", q);
  expect(b.status).toBe(200);
  expect(b.headers.get("Content-Type")).toMatch(/text\/csv/);
  expect(await b.text()).toContain("America/New_York");
  expect(load.mock.calls.at(-1)?.[0]).toMatchObject({
    report: "payments",
    page: 1,
    pageSize: 100,
  });
});
test("maps unexpected errors to fixed private output", async () => {
  load.mockRejectedValueOnce(Error("private-fixture"));
  const res = await call(json, "sales");
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain("private-fixture");
});
