import { randomUUID } from "node:crypto";
import {
  submitClaimHandler,
  recoverClaimHandler,
  type ClaimDependencies,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-handler";
import { ClaimRepositoryError } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-repository";
import {
  deriveEligibilityKeys,
  fingerprintInput,
  getIdentityKeyFingerprint,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/normalize-identity";
import { issueEligibilityToken } from "@/Modules/SpecialtyProducts/Source/Features/Claim/validation-token";

const secret = "a-test-specialty-signing-secret-with-at-least-32-chars";
const now = 1800000000000;
const context = {
  campaignId: randomUUID(),
  productId: randomUUID(),
  browserId: "test-browser-cookie-id",
  normalizationVersion: 1 as const,
  identityKeyFingerprint: getIdentityKeyFingerprint(secret),
};
const address = {
  line1: "123 MAIN ST",
  line2: null,
  city: "COLUMBIA",
  state: "SC",
  postalCode: "29201",
  country: "US" as const,
};
const credentials = { attemptId: randomUUID(), recoverySecret: "a".repeat(64) };
const input = {
  ...credentials,
  productId: context.productId,
  instagramHandle: "@Sole",
  address,
};
const proof = {
  ...context,
  instagramHandle: "sole",
  address,
  ...deriveEligibilityKeys(context.campaignId, "sole", address, secret),
  identityKeyFingerprint: getIdentityKeyFingerprint(secret),
  expiresAt: now + 600000,
};
const request = (body: unknown = input) =>
  new Request("https://example.com/api/specialty/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "https://example.com" },
    body: JSON.stringify(body),
  });
function dependencies(): ClaimDependencies {
  return {
    secret: () => secret,
    nowMs: () => now,
    getContext: () => Promise.resolve(context),
    protect: () => Promise.resolve({ allowed: true }),
    validateAddress: (value) => Promise.resolve({ status: "valid", address: value }),
    findAttempt: () => Promise.resolve(null),
    accept: () =>
      Promise.resolve({ result: { status: "already_claimed" }, replayed: false }),
    recordMetric: () => {},
  };
}
describe("specialty claim HTTP decisions", () => {
  test("submits verified identity hashes and never forwards recovery credentials to the award", async () => {
    const deps = dependencies();
    const accept = jest.fn(deps.accept);
    deps.accept = accept;
    const response = await submitClaimHandler(
      request({ ...input, validationToken: issueEligibilityToken(proof, secret) }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { status: "already_claimed" },
      replayed: false,
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const command = accept.mock.calls[0][0];
    expect(command.eligibility.instagramHandle).toBe("sole");
    expect(command.recoveryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(command).not.toHaveProperty("recoverySecret");
  });
  test("replays a committed result before context, provider, or token checks", async () => {
    const deps = dependencies();
    deps.findAttempt = () =>
      Promise.resolve({
        inputHash: fingerprintInput(input, secret),
        payloadHash: "d".repeat(64),
        result: { status: "sold_out" },
      });
    deps.getContext = () => {
      return Promise.reject(new Error("archived"));
    };
    deps.validateAddress = () => {
      return Promise.reject(new Error("provider down"));
    };
    deps.accept = () => {
      return Promise.reject(new Error("must not award twice"));
    };
    const response = await submitClaimHandler(
      request({ ...input, validationToken: "expired" }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { status: "sold_out" },
      replayed: true,
    });
  });
  test("rejects changed input bound to a committed attempt", async () => {
    const deps = dependencies();
    deps.findAttempt = () =>
      Promise.resolve({
        inputHash: "d".repeat(64),
        payloadHash: "e".repeat(64),
        result: { status: "sold_out" },
      });
    expect((await submitClaimHandler(request(), deps)).status).toBe(409);
  });
  test.each(["tampered", "expired"])(
    "rejects %s proof without a database award",
    async (kind) => {
      const deps = dependencies();
      deps.accept = () => {
        return Promise.reject(new Error("not eligible"));
      };
      const token =
        kind === "tampered"
          ? "bad-token"
          : issueEligibilityToken({ ...proof, expiresAt: now - 1 }, secret);
      const response = await submitClaimHandler(
        request({ ...input, validationToken: token }),
        deps,
      );
      expect(response.status).toBe(422);
      expect((await response.json()).status).toBe("validation_required");
    },
  );
  test("missing proof validates inline without reserving a corrected address", async () => {
    const deps = dependencies();
    deps.validateAddress = () =>
      Promise.resolve({
        status: "correction_required",
        address: { ...address, line1: "125 MAIN ST" },
      });
    const response = await submitClaimHandler(request(), deps);
    expect(response.status).toBe(422);
    expect((await response.json()).status).toBe("validation_required");
  });
  test.each([null, "different-key-with-more-than-32-characters"])(
    "refuses fresh acceptance with unavailable/mismatched secret",
    async (key) => {
      const deps = dependencies();
      deps.secret = () => key;
      expect((await submitClaimHandler(request(), deps)).status).toBe(503);
    },
  );
  test("credential-only recovery survives missing signing secret and closed campaign", async () => {
    const deps = dependencies();
    deps.secret = () => null;
    deps.getContext = () => {
      return Promise.reject(new Error("closed"));
    };
    deps.validateAddress = () => {
      return Promise.reject(new Error("no provider"));
    };
    deps.accept = () => {
      return Promise.reject(new Error("no award"));
    };
    deps.findAttempt = () =>
      Promise.resolve({
        inputHash: "d".repeat(64),
        payloadHash: "e".repeat(64),
        result: { status: "closed" },
      });
    const response = await recoverClaimHandler(request(credentials), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { status: "closed" },
      replayed: true,
    });
  });
  test("unknown result is pending, while failed reads are retryable and wrong credentials forbidden", async () => {
    const deps = dependencies();
    expect((await recoverClaimHandler(request(credentials), deps)).status).toBe(202);
    for (const [code, status] of [
      ["temporary_unavailable", 503],
      ["unauthorized", 403],
      ["payload_conflict", 409],
    ] as const) {
      deps.findAttempt = () => {
        return Promise.reject(new ClaimRepositoryError(code));
      };
      const response = await recoverClaimHandler(request(credentials), deps);
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
  });
  test("throttled requests receive retry guidance", async () => {
    const deps = dependencies();
    deps.protect = () =>
      Promise.resolve({ allowed: false, status: 429, retryAfterSeconds: 9 });
    const response = await submitClaimHandler(request(), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("9");
  });
  test("oversized and malformed JSON are rejected before processing", async () => {
    for (const body of ["{", JSON.stringify({ extra: "x".repeat(17000) })]) {
      const response = await submitClaimHandler(
        new Request("https://example.com", { method: "POST", body }),
        dependencies(),
      );
      expect([413, 422]).toContain(response.status);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
  });
  test("telemetry and errors contain no contact data or raw provider messages", async () => {
    const deps = dependencies();
    const events: unknown[] = [];
    deps.recordMetric = (event) => {
      events.push(event);
    };
    deps.accept = () => {
      return Promise.reject(new Error("private 123 MAIN ST @Sole token"));
    };
    const response = await submitClaimHandler(request(), deps);
    expect(response.status).toBe(503);
    const serialized = JSON.stringify([await response.json(), events]);
    for (const sensitive of [
      "123 MAIN ST",
      "@Sole",
      credentials.recoverySecret,
      "private",
    ])
      expect(serialized).not.toContain(sensitive);
  });
});
