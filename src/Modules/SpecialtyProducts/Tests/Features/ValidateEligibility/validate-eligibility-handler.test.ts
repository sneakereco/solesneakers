import {
  validateEligibilityHandler,
  type EligibilityDependencies,
} from "@/Modules/SpecialtyProducts/Source/Features/ValidateEligibility/validate-eligibility-handler";
import { getIdentityKeyFingerprint } from "@/Modules/SpecialtyProducts/Source/Features/Claim/normalize-identity";
import { verifyEligibilityToken } from "@/Modules/SpecialtyProducts/Source/Features/Claim/validation-token";

const secret = "specialty-handler-test-secret-at-least-32-characters";
const now = 1_800_000_000_000;
const context = {
  campaignId: "11111111-1111-4111-8111-111111111111",
  productId: "22222222-2222-4222-8222-222222222222",
  browserId: "fixture-browser-context",
  normalizationVersion: 1 as const,
  identityKeyFingerprint: getIdentityKeyFingerprint(secret),
};
const address = {
  line1: "123 MAIN ST",
  line2: "APT 4",
  city: "COLUMBIA",
  state: "SC",
  postalCode: "29201",
  country: "US" as const,
};
const body = { productId: context.productId, instagramHandle: " @Sole ", address };
const request = (input: unknown = body) =>
  new Request("https://example.com/api/specialty/eligibility", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
function dependencies(): EligibilityDependencies {
  return {
    getContext: async () => context,
    protect: async () => ({ allowed: true }),
    validateAddress: async (value) => ({ status: "valid", address: value }),
    secret: () => secret,
    nowMs: () => now,
  };
}
describe("specialty eligibility validation", () => {
  test("issues a signed canonical eligibility proof with no stock operation", async () => {
    const response = await validateEligibilityHandler(request(), dependencies());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(data.status).toBe("valid");
    const proof = verifyEligibilityToken(data.validationToken, context, secret, now);
    expect(proof?.instagramHandle).toBe("sole");
    expect(proof?.address).toEqual(address);
  });
  test("requires confirmation before a corrected address becomes eligible", async () => {
    const corrected = { ...address, line1: "125 MAIN ST" };
    const deps = dependencies();
    const validateAddress = jest
      .fn()
      .mockResolvedValue({ status: "correction_required", address: corrected });
    deps.validateAddress = validateAddress;
    const suggestion = await (await validateEligibilityHandler(request(), deps)).json();
    expect(suggestion.status).toBe("correction_required");
    expect(
      verifyEligibilityToken(suggestion.correctionToken, context, secret, now),
    ).toBeNull();
    const confirmed = await (
      await validateEligibilityHandler(
        request({
          ...body,
          address: corrected,
          correctionToken: suggestion.correctionToken,
        }),
        deps,
      )
    ).json();
    expect(confirmed.status).toBe("valid");
    expect(
      verifyEligibilityToken(confirmed.validationToken, context, secret, now)?.address
        .line1,
    ).toBe("125 MAIN ST");
    expect(validateAddress).toHaveBeenCalledTimes(1);
  });
  test("rejects editing the handle or address while confirming a correction", async () => {
    const deps = dependencies();
    deps.validateAddress = async () => ({ status: "correction_required", address });
    const suggestion = await (await validateEligibilityHandler(request(), deps)).json();
    for (const edit of [
      { instagramHandle: "another" },
      { address: { ...address, line2: "APT 5" } },
    ]) {
      const response = await validateEligibilityHandler(
        request({ ...body, ...edit, correctionToken: suggestion.correctionToken }),
        deps,
      );
      expect(response.status).toBe(422);
      expect((await response.json()).status).toBe("invalid");
    }
  });
  test("key rotation and provider failures fail closed without leaking input", async () => {
    const deps = dependencies();
    deps.getContext = async () => ({
      ...context,
      identityKeyFingerprint: "f".repeat(64),
    });
    expect((await validateEligibilityHandler(request(), deps)).status).toBe(503);
    deps.getContext = async () => context;
    deps.validateAddress = async () => {
      throw new Error("123 MAIN ST private");
    };
    const response = await validateEligibilityHandler(request(), deps);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("123 MAIN ST");
  });
  test("returns retry guidance for protection throttling", async () => {
    const deps = dependencies();
    deps.protect = async () => ({ allowed: false, status: 429, retryAfterSeconds: 4 });
    const response = await validateEligibilityHandler(request(), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("4");
  });
  test("rejects unnecessary contact information and malformed handles", async () => {
    for (const input of [
      { ...body, email: "not-needed@example.com" },
      { ...body, instagramHandle: "@@bad" },
    ]) {
      const response = await validateEligibilityHandler(request(input), dependencies());
      expect(response.status).toBe(422);
      expect((await response.json()).status).toBe("invalid");
    }
  });
});
