import { createDeliveryRepository } from "../../../Source/Features/EventDelivery/delivery-repository";
import { deliverAnalyticsBatch } from "../../../Source/Features/EventDelivery/delivery-worker";
import { readServerAnalyticsConfig } from "../../../Source/Features/Configuration/server-config";
import { mockFetch, now, validEnv } from "../Configuration/config-fixture";
import { base, id, payloads } from "../CommerceFacts/fixtures";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { GET } from "@/app/api/cron/analytics/route";
import {
  runAnalyticsDrain,
  analyticsRuntimeIdentity,
} from "../../../Source/Features/EventDelivery/delivery-runtime";
import { security } from "@/config/security";
jest.mock("../../../Source/Features/EventDelivery/delivery-runtime", () => ({
  runAnalyticsDrain: jest.fn(),
  analyticsRuntimeIdentity: jest.fn(),
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
it.each([false, true])(
  "reports the atomic newly exhausted count through the worker and authorized cron, including mixed=%s",
  async (mixed) => {
    const config = readServerAnalyticsConfig(validEnv)!;
    const fact = { ...base, revision: 2, kind: "order", payload: payloads.order };
    const jobs = mixed
      ? [
          {
            publication_id: id,
            lease_token: id,
            lease_expires_at: base.effectiveAt,
            attempt: 1,
            environment: "staging",
            fact,
          },
        ]
      : [];
    const rpc = jest
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve(
          name === "analytics_claim_batch"
            ? { data: { exhausted: 1, jobs }, error: null }
            : { data: true, error: null },
        ),
      );
    const repository = createDeliveryRepository(
      { rpc } as unknown as AdminSupabaseClient,
      base.datasetId,
    );
    const fetch = mockFetch().mockResolvedValue(Response.json({ status: 1 }));
    jest.mocked(runAnalyticsDrain).mockImplementation(() =>
      deliverAnalyticsBatch(
        {
          ...repository,
          config,
          now,
          fetch,
          getActivePurchaseContext: () => Promise.resolve(null),
        },
        { limit: 50, deadlineMs: 8000 },
      ),
    );
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s".repeat(40);
    try {
      const result = await GET(
        new Request("https://sole.test/api/cron/analytics", {
          headers: { authorization: "Bearer " + process.env.CRON_SECRET },
        }),
      );
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({
        claimed: mixed ? 2 : 1,
        delivered: mixed ? 1 : 0,
        failed: 1,
        deferred: 0,
      });
      expect(fetch).toHaveBeenCalledTimes(mixed ? 1 : 0);
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  },
);

it("protects configuration inspection and does not claim or publish jobs", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "s".repeat(40);
  jest.mocked(runAnalyticsDrain).mockClear();
  jest.mocked(analyticsRuntimeIdentity).mockReturnValue({
    enabled: true,
    environment: "staging",
    configurationSha256: "a".repeat(64),
    publicBuildSha256: "b".repeat(64),
  });
  try {
    expect(
      (await GET(new Request("https://sole.test/api/cron/analytics?inspect=1"))).status,
    ).toBe(401);
    expect(analyticsRuntimeIdentity).not.toHaveBeenCalled();
    const response = await GET(
      new Request("https://sole.test/api/cron/analytics?inspect=1", {
        headers: { authorization: "Bearer " + process.env.CRON_SECRET },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      environment: "staging",
    });
    expect(runAnalyticsDrain).not.toHaveBeenCalled();
  } finally {
    jest.mocked(analyticsRuntimeIdentity).mockClear();
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
