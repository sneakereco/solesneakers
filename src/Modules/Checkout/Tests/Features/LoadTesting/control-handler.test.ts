import { handleLoadTestControl } from "../../../Source/Features/LoadTesting/control-handler";
import {
  verifyHarnessRequest,
  issuePhaseCredential,
} from "../../../Source/Features/LoadTesting/context";
import {
  fixtureSettings,
  fixtureRun,
  MemoryRunStore,
  signControlRequest,
} from "./fixtures";

describe("load control plane", () => {
  test("only a live worker credential admits its own slots after partitioning", async () => {
    const { settings } = fixtureSettings(),
      store = new MemoryRunStore(),
      run = fixtureRun(settings.target.digest);
    await store.put("run", run.runId, run);
    const root = issuePhaseCredential(run, settings);
    const response = await handleLoadTestControl(
      signControlRequest(settings, "lease", {
        nonce: "scope",
        runId: run.runId,
        workerId: "http-0",
        start: 0,
        end: 100,
      }),
      "lease",
      { settings, store },
    );
    const body = await response.json();
    const request = (token: string, slot = 1) =>
      new Request(settings.target.baseUrl + "/api/checkout/quote", {
        headers: { "x-load-test-credential": token, "x-load-test-slot": String(slot) },
      });
    expect(
      (await verifyHarnessRequest(request(body.credential), settings, store))?.slot,
    ).toBe(1);
    await expect(
      verifyHarnessRequest(request(body.credential, 100), settings, store),
    ).rejects.toThrow();
    await expect(verifyHarnessRequest(request(root), settings, store)).rejects.toThrow();
    await store.put("leases", run.runId, {
      runId: run.runId,
      workers: { "http-0": { start: 0, end: 100, expiresAt: Date.now() - 1 } },
    });
    await expect(
      verifyHarnessRequest(request(body.credential), settings, store),
    ).rejects.toThrow();
  });
  test("worker ranges cannot overlap and expired heartbeats reject new shopper work", async () => {
    const { settings } = fixtureSettings(),
      store = new MemoryRunStore(),
      run = fixtureRun(settings.target.digest);
    await store.put("run", run.runId, run);
    const call = (nonce: string, start: number, end: number, workerId: string) =>
      handleLoadTestControl(
        signControlRequest(settings, "lease", {
          nonce,
          runId: run.runId,
          start,
          end,
          workerId,
        }),
        "lease",
        { settings, store },
      );
    expect((await call("a", 0, 100, "http-0")).status).toBe(200);
    expect((await call("b", 50, 150, "http-1")).status).toBe(503);
  });
  test("expired dirty target lease blocks a different run until scoped cleanup", async () => {
    const { settings } = fixtureSettings(),
      store = new MemoryRunStore(),
      run = fixtureRun(settings.target.digest);
    await store.put("lock", "target", { runId: run.runId, expiresAt: Date.now() - 1 });
    const response = await handleLoadTestControl(
      signControlRequest(settings, "register", {
        nonce: "dirty",
        runId: "22222222-2222-4222-8222-222222222222",
        phaseId: "smoke",
        profile: "smoke",
        start: 0,
        end: 10,
        expiresAt: Date.now() + 60000,
      }),
      "register",
      { settings, store },
    );
    expect(response.status).toBe(503);
  });
  test("operator can enumerate durable owned outcomes beyond the first page", async () => {
    const { settings } = fixtureSettings(),
      store = new MemoryRunStore(),
      run = fixtureRun(settings.target.digest);
    await store.put("run", run.runId, run);
    for (let index = 0; index < 105; index++)
      await store.mutate("owned", String(index), index, (value) => value, {
        kind: "owned-orders",
        id: run.runId,
        value: () => `order-${index}`,
      });
    const response = await handleLoadTestControl(
      signControlRequest(settings, "status", { runId: run.runId, cursor: 100 }),
      "status",
      { settings, store },
    );
    const page = await response.json();
    expect(page.ownedOrderIds).toHaveLength(5);
    expect(page.ownedOrderIds[0]).toBe("order-100");
    expect(page.nextCursor).toBeNull();
  });
  test("disabled endpoint is absent and unsigned enabled requests are forbidden", async () => {
    const request = new Request(
      "https://load.example.test/api/internal/load-test/attest",
      { method: "POST", body: "{}" },
    );
    expect(
      (
        await handleLoadTestControl(request, "attest", {
          settings: null,
          store: new MemoryRunStore(),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await handleLoadTestControl(request, "attest", {
          ...fixtureSettings(),
          store: new MemoryRunStore(),
        })
      ).status,
    ).toBe(403);
  });
  test("signed attestation is no-store, nonce-bound and contains no root signing key", async () => {
    const { settings } = fixtureSettings(),
      store = new MemoryRunStore();
    const request = signControlRequest(settings, "attest", { nonce: "nonce-1" });
    const response = await handleLoadTestControl(request, "attest", { settings, store });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain(settings.target.expected.commit);
    expect(body).not.toContain(settings.signingKey);
    expect(
      (await handleLoadTestControl(request.clone(), "attest", { settings, store }))
        .status,
    ).toBe(403);
  });
  test("registration bounds slots/deadlines and revoked credentials remain unusable", async () => {
    const { settings } = fixtureSettings(),
      store = new MemoryRunStore();
    const invalid = signControlRequest(settings, "register", {
      nonce: "bad",
      runId: "11111111-1111-4111-8111-111111111111",
      phaseId: "peak-1",
      profile: "peak",
      start: 0,
      end: 12001,
      expiresAt: Date.now() + 60000,
    });
    expect(
      (await handleLoadTestControl(invalid, "register", { settings, store })).status,
    ).toBe(400);
    const valid = signControlRequest(settings, "register", {
      nonce: "good",
      runId: "11111111-1111-4111-8111-111111111111",
      phaseId: "peak-1",
      profile: "peak",
      start: 0,
      end: 10000,
      expiresAt: Date.now() + 60000,
    });
    const response = await handleLoadTestControl(valid, "register", { settings, store });
    expect(response.status).toBe(200);
    expect((await response.json()).credential).toEqual(expect.any(String));
    const unsafe = signControlRequest(settings, "sql", {
      nonce: "unsafe",
      sql: "drop table orders",
    });
    expect((await handleLoadTestControl(unsafe, "sql", { settings, store })).status).toBe(
      404,
    );
  });
});
