import {
  canonicalAddressIdentity,
  deriveEligibilityKeys,
  fingerprintInput,
  getIdentityKeyFingerprint,
  hashRecoverySecret,
  normalizeInstagramHandle,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/normalize-identity";
import {
  claimSubmissionSchema,
  eligibilityAddressSchema,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-contract";

const address = {
  line1: "123 Main Street",
  line2: "Apt 4",
  city: "Columbia",
  state: "SC",
  postalCode: "29201",
  country: "US" as const,
};
const secret = "specialty-test-secret-32-characters-minimum";
describe("specialty identity normalization", () => {
  test.each([
    ["  @SoLe.Example_1 ", "sole.example_1"],
    ["ＳＯＬＥ", "sole"],
    ["@Sole", "sole"],
    ["sole.name", "sole.name"],
    ["sole_name", "sole_name"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeInstagramHandle(input)).toBe(expected);
  });
  test.each([
    "",
    "@@sole",
    "sole name",
    "https://instagram.com/sole",
    "sole/name",
    "soле",
    "a".repeat(31),
  ])("rejects malformed handle %s", (input) => {
    expect(() => normalizeInstagramHandle(input)).toThrow();
  });
  test("keeps different valid punctuation distinct", () => {
    expect(normalizeInstagramHandle("sole.name")).not.toBe(
      normalizeInstagramHandle("sole_name"),
    );
  });
  test("canonicalizes case, ZIP+4, street suffix and equivalent apartment designators", () => {
    const expected = '["123 MAIN ST","4","COLUMBIA","SC","29201","US"]';
    expect(canonicalAddressIdentity(address)).toBe(expected);
    expect(
      canonicalAddressIdentity({
        ...address,
        line1: " 123 main st. ",
        line2: "#4",
        city: "columbia",
        state: "sc",
        postalCode: "29201-1234",
      }),
    ).toBe(expected);
    expect(
      canonicalAddressIdentity({ ...address, line1: "123 Main St Apt 4", line2: null }),
    ).toBe(expected);
  });
  test("preserves different units and meaningful house-number punctuation", () => {
    expect(canonicalAddressIdentity({ ...address, line2: "Unit 5" })).not.toBe(
      canonicalAddressIdentity(address),
    );
    expect(canonicalAddressIdentity({ ...address, line1: "12-14 Main St" })).not.toBe(
      canonicalAddressIdentity({ ...address, line1: "1214 Main St" }),
    );
  });
  test("rejects conflicting inline and secondary units", () => {
    expect(() =>
      canonicalAddressIdentity({ ...address, line1: "123 Main St Apt 5" }),
    ).toThrow();
  });
  test("separates campaign and key purposes and pins key identity", () => {
    const keys = deriveEligibilityKeys("campaign-a", "@Sole", address, secret);
    expect(keys).toEqual(
      deriveEligibilityKeys("campaign-a", "SOLE", { ...address, line2: "#4" }, secret),
    );
    expect(keys.addressKey).toMatch(/^[a-f0-9]{64}$/);
    expect(keys.addressKey).not.toBe(keys.instagramKey);
    expect(keys.addressKey).not.toBe(
      deriveEligibilityKeys("campaign-b", "sole", address, secret).addressKey,
    );
    expect(getIdentityKeyFingerprint(secret)).not.toBe(
      getIdentityKeyFingerprint(secret + "2"),
    );
    expect(() => deriveEligibilityKeys("campaign-a", "sole", address, "")).toThrow();
  });
  test("binds retries to submitted fields while preserving case-equivalent input", () => {
    const input = { productId: "product-a", instagramHandle: "@Sole", address };
    expect(fingerprintInput(input, secret)).toBe(
      fingerprintInput(
        { ...input, instagramHandle: "sole", address: { ...address, city: "COLUMBIA" } },
        secret,
      ),
    );
    expect(fingerprintInput(input, secret)).not.toBe(
      fingerprintInput({ ...input, productId: "product-b" }, secret),
    );
    expect(hashRecoverySecret("a".repeat(64))).toMatch(/^[a-f0-9]{64}$/);
  });
  test("accepts only the eligibility fields, without checkout/contact extras", () => {
    expect(
      eligibilityAddressSchema.safeParse({ ...address, country: "CA" }).success,
    ).toBe(false);
    expect(eligibilityAddressSchema.safeParse({ ...address, line1: "" }).success).toBe(
      false,
    );
    expect(eligibilityAddressSchema.parse({ ...address, line2: " " }).line2).toBeNull();
    const input = {
      productId: "11111111-1111-4111-8111-111111111111",
      attemptId: "22222222-2222-4222-8222-222222222222",
      recoverySecret: "a".repeat(64),
      instagramHandle: "sole",
      address,
    };
    expect(claimSubmissionSchema.safeParse(input).success).toBe(true);
    expect(
      claimSubmissionSchema.safeParse({ ...input, email: "unneeded@example.com" })
        .success,
    ).toBe(false);
  });
});
