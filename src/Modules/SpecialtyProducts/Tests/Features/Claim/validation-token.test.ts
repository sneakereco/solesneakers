import {
  issueEligibilityToken,
  verifyEligibilityToken,
  issueCorrectionToken,
  verifyCorrectionToken,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/validation-token";
import {
  deriveEligibilityKeys,
  getIdentityKeyFingerprint,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/normalize-identity";
import type { ValidatedEligibility } from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-contract";
const secret = "specialty-token-test-secret-at-least-32-characters";
const now = 1_800_000_000_000;
const binding = {
  campaignId: "11111111-1111-4111-8111-111111111111",
  productId: "22222222-2222-4222-8222-222222222222",
  browserId: "test-browser-context",
};
const address = {
  line1: "123 MAIN ST",
  line2: "APT 4",
  city: "COLUMBIA",
  state: "SC",
  postalCode: "29201",
  country: "US" as const,
};
function eligibility(): ValidatedEligibility {
  return {
    ...binding,
    address,
    instagramHandle: "sole",
    ...deriveEligibilityKeys(binding.campaignId, "sole", address, secret),
    identityKeyFingerprint: getIdentityKeyFingerprint(secret),
    normalizationVersion: 1,
    expiresAt: now + 600_000,
  };
}
describe("purpose-bound specialty eligibility tokens", () => {
  test("authenticates a complete eligibility proof", () => {
    const value = eligibility();
    expect(
      verifyEligibilityToken(issueEligibilityToken(value, secret), binding, secret, now),
    ).toEqual(value);
  });
  test("rejects expiration at the boundary", () => {
    const token = issueEligibilityToken(eligibility(), secret);
    expect(verifyEligibilityToken(token, binding, secret, now + 599_999)).not.toBeNull();
    expect(verifyEligibilityToken(token, binding, secret, now + 600_000)).toBeNull();
  });
  test("rejects forged signatures, malformed content and edited addresses", () => {
    const token = issueEligibilityToken(eligibility(), secret);
    const [payload, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.value.address.line2 = "APT 5";
    expect(
      verifyEligibilityToken(
        Buffer.from(JSON.stringify(decoded)).toString("base64url") + "." + sig,
        binding,
        secret,
        now,
      ),
    ).toBeNull();
    expect(verifyEligibilityToken(payload + ".bad", binding, secret, now)).toBeNull();
    expect(verifyEligibilityToken("not-a-token", binding, secret, now)).toBeNull();
    expect(verifyEligibilityToken(token, binding, "", now)).toBeNull();
  });
  test.each(["campaignId", "productId", "browserId"] as const)(
    "binds proof to %s",
    (key) => {
      const token = issueEligibilityToken(eligibility(), secret);
      expect(
        verifyEligibilityToken(token, { ...binding, [key]: "different" }, secret, now),
      ).toBeNull();
    },
  );
  test("a correction proposal cannot authorize an award", () => {
    const value = eligibility();
    const correction = issueCorrectionToken(value, secret);
    expect(verifyEligibilityToken(correction, binding, secret, now)).toBeNull();
    expect(verifyCorrectionToken(correction, binding, secret, now)).toEqual(value);
    expect(
      verifyCorrectionToken(issueEligibilityToken(value, secret), binding, secret, now),
    ).toBeNull();
  });
  test("refuses to issue an eligibility token with a different key identity", () => {
    expect(() =>
      issueEligibilityToken(
        { ...eligibility(), identityKeyFingerprint: "f".repeat(64) },
        secret,
      ),
    ).toThrow();
  });
});
