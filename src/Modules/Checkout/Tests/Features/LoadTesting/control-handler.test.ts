import { handleLoadTestControl } from "../../../Source/Features/LoadTesting/control-handler";
import { fixtureSettings, MemoryRunStore, signControlRequest } from "./fixtures";

describe("load control plane", () => {
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
