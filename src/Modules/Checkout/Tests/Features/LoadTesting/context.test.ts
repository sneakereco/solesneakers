import { readLoadTestSettings } from "../../../Source/Features/LoadTesting/settings";
import {
  issuePhaseCredential,
  verifyHarnessRequest,
  resolveFixtureContext,
  withLoadTestContext,
  getActiveLoadTestContext,
  isHarnessShopperRoute,
} from "../../../Source/Features/LoadTesting/context";
import { fixtureRun, fixtureSettings, MemoryRunStore } from "./fixtures";

describe("staging harness admission", () => {
  test("a shopper credential cannot admit an unknown nested operation", () => {
    expect(isHarnessShopperRoute("/api/checkout/export")).toBe(false);
    expect(isHarnessShopperRoute("/api/store/admin")).toBe(false);
    expect(isHarnessShopperRoute("/api/checkout/quote")).toBe(true);
  });
  test("disabled mode returns no test context even with a forged header", async () => {
    expect(readLoadTestSettings({})).toBeNull();
    const request = new Request("https://shop.example.test/api/checkout/quote", {
      headers: { "x-load-test-credential": "forged" },
    });
    expect(await verifyHarnessRequest(request, null, new MemoryRunStore())).toBeNull();
  });
  test("production deployment label is allowed only for the positively verified staging project", () => {
    const { env, settings } = fixtureSettings();
    expect(settings.target.expected.projectId).toBe(env.VERCEL_PROJECT_ID);
    for (const change of [
      { VERCEL_PROJECT_ID: "prj_production_fixture" },
      { VERCEL_DEPLOYMENT_ID: "wrong" },
      { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) },
      { NEXT_PUBLIC_SUPABASE_URL: "https://productionfixture.supabase.co" },
      { UPSTASH_REDIS_REST_URL: "https://production.upstash.io" },
      { LOAD_TEST_SIGNING_KEY: "short" },
    ])
      expect(() => readLoadTestSettings({ ...env, ...change })).toThrow();
  });
  test("a valid phase credential cannot be used on another host, slot, phase or admin route", async () => {
    const { settings } = fixtureSettings(),
      store = new MemoryRunStore(),
      run = fixtureRun(settings.target.digest);
    await store.put("run", run.runId, run);
    const token = issuePhaseCredential(run, settings);
    const request = (url: string, slot = "10", credential = token) =>
      new Request(url, {
        headers: {
          "x-load-test-credential": credential,
          "x-load-test-slot": slot,
          "x-forwarded-for": "1.2.3.4",
        },
      });
    const context = await verifyHarnessRequest(
      request(`${settings.target.baseUrl}/api/checkout/quote`),
      settings,
      store,
    );
    expect(context?.slot).toBe(10);
    expect(context?.networkKey).not.toBe("1.2.3.4");
    for (const [url, slot] of [
      ["https://wrong.example.test/api/checkout/quote", "10"],
      [`${settings.target.baseUrl}/admin`, "10"],
      [`${settings.target.baseUrl}/api/checkout/quote`, "10000"],
      [`${settings.target.baseUrl}/api/checkout/quote`, "-1"],
    ])
      await expect(
        verifyHarnessRequest(request(url, slot), settings, store),
      ).rejects.toThrow();
    await expect(
      verifyHarnessRequest(
        request(`${settings.target.baseUrl}/api/checkout/quote`, "10", `${token}x`),
        settings,
        store,
      ),
    ).rejects.toThrow();
    await store.put("run", run.runId, { ...run, phaseId: "next-phase" });
    await expect(
      verifyHarnessRequest(
        request(`${settings.target.baseUrl}/api/checkout/quote`),
        settings,
        store,
      ),
    ).rejects.toThrow();
  });
  test("expired and revoked phases fail before provider selection", async () => {
    const { settings } = fixtureSettings(),
      store = new MemoryRunStore(),
      run = fixtureRun(settings.target.digest);
    const token = issuePhaseCredential(run, settings);
    const request = new Request(`${settings.target.baseUrl}/api/checkout/pay`, {
      headers: { "x-load-test-credential": token, "x-load-test-slot": "1" },
    });
    await store.put("run", run.runId, { ...run, revoked: true });
    await expect(verifyHarnessRequest(request, settings, store)).rejects.toThrow();
    await store.put("run", run.runId, { ...run, expiresAt: Date.now() - 1 });
    await expect(verifyHarnessRequest(request, settings, store)).rejects.toThrow();
  });
  test("background fixture context requires durable ownership, and concurrent requests cannot share context", async () => {
    const { settings } = fixtureSettings(),
      store = new MemoryRunStore(),
      run = fixtureRun(settings.target.digest);
    await store.put("run", run.runId, run);
    expect(await resolveFixtureContext("order", "unknown", settings, store)).toBeNull();
    await store.put("fixture", "order:owned", { runId: run.runId, slot: 3 });
    const context = await resolveFixtureContext("order", "owned", settings, store);
    expect(context?.slot).toBe(3);
    expect(
      await withLoadTestContext(context!, async () => {
        await Promise.resolve();
        return getActiveLoadTestContext()?.slot;
      }),
    ).toBe(3);
    expect(getActiveLoadTestContext()).toBeNull();
  });
});
