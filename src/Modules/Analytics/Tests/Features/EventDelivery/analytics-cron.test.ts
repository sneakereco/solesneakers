import { GET } from "@/app/api/cron/analytics/route";
import { runAnalyticsDrain } from "../../../Source/Features/EventDelivery/delivery-runtime";
import { security } from "@/config/security";
jest.mock("../../../Source/Features/EventDelivery/delivery-runtime", () => ({
  runAnalyticsDrain: jest.fn(),
}));
jest.mock("server-only", () => ({}), { virtual: true });
it("permits the exact locked-site cron path and requires its bearer credential", async () => {
  const old = process.env.CRON_SECRET;
  const secret = "x".repeat(48);
  process.env.CRON_SECRET = secret;
  try {
    expect(security.proxy.siteLockBypassExactPaths).toContain("/api/cron/analytics");
    expect((await GET(new Request("https://sole.test/api/cron/analytics"))).status).toBe(
      401,
    );
    expect(runAnalyticsDrain).not.toHaveBeenCalled();
    jest
      .mocked(runAnalyticsDrain)
      .mockResolvedValue({ claimed: 2, delivered: 1, deferred: 1, failed: 0 });
    const response = await GET(
      new Request("https://sole.test/api/cron/analytics", {
        headers: { authorization: "Bearer " + secret },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ delivered: 1, deferred: 1 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  } finally {
    if (old === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = old;
  }
});
