import { validateEligibilityAddress } from "@/Modules/SpecialtyProducts/Source/Features/ValidateEligibility/address-provider";
import {
  canonicalAddressIdentity,
  deriveEligibilityKeys,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/normalize-identity";

const address = {
  line1: "123 Main Street",
  line2: "Apt 4",
  city: "Columbia",
  state: "SC",
  postalCode: "29201",
  country: "US" as const,
};
const recommended = {
  address_line_1: "123 MAIN ST",
  address_line_2: "APT 4",
  city_locality: "COLUMBIA",
  state_province: "SC",
  postal_code: "29201-1234",
  country_code: "US",
  confidence_result: { score: "high" },
};
const provider = (recommendation: unknown = recommended, value = "valid", status = 200) =>
  jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        analysis: { validation_result: { value } },
        recommended_address: recommendation,
      }),
      { status },
    ),
  );
describe("canonical specialty address provider", () => {
  test.each(["omitted", "null"])(
    "accepts an unchanged provider-valid address with %s recommendation",
    async (recommendation) => {
      const fetcher = jest.fn().mockResolvedValue(
        Response.json({
          analysis: { validation_result: { value: "valid" } },
          ...(recommendation === "null" ? { recommended_address: null } : {}),
        }),
      );
      const result = await validateEligibilityAddress(
        { ...address, line1: " 123 Main Street ", state: "sc" },
        { token: "fixture-token", fetcher },
      );
      expect(result).toEqual({ status: "valid", address });
    },
  );
  test("uses validated canonical output with no name, email, phone or reservation", async () => {
    const fetcher = provider();
    const result = await validateEligibilityAddress(address, {
      token: "fixture-token",
      fetcher,
    });
    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error("expected canonical address");
    expect(result.address).toEqual({
      line1: "123 MAIN ST",
      line2: "APT 4",
      city: "COLUMBIA",
      state: "SC",
      postalCode: "29201-1234",
      country: "US",
    });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.origin).toBe("https://api.goshippo.com");
    expect([...url.searchParams.keys()]).toEqual([
      "address_line_1",
      "address_line_2",
      "city_locality",
      "state_province",
      "postal_code",
      "country_code",
    ]);
  });
  test("matches units moved between address lines while preserving a distinct unit", async () => {
    const a = await validateEligibilityAddress(
      { ...address, line1: "123 Main St Apt 4", line2: null },
      { token: "fixture-token", fetcher: provider() },
    );
    const b = await validateEligibilityAddress(
      { ...address, line2: "#4" },
      { token: "fixture-token", fetcher: provider() },
    );
    expect(a.status).toBe("valid");
    expect(b.status).toBe("valid");
    if (a.status !== "valid" || b.status !== "valid")
      throw new Error("expected canonical addresses");
    expect(canonicalAddressIdentity(a.address)).toBe(canonicalAddressIdentity(b.address));
    expect(canonicalAddressIdentity(a.address)).not.toBe(
      canonicalAddressIdentity({ ...a.address, line2: "APT 5" }),
    );
  });
  test("preserves address deduplication and distinct units without a recommendation", async () => {
    const inputs = [
      address,
      {
        ...address,
        line1: " 123 main st. ",
        line2: "#4",
        city: "columbia",
        state: "sc",
        postalCode: "29201-1234",
      },
      { ...address, line1: "123 Main St Apt 4", line2: null },
      { ...address, line2: "Unit 5" },
    ];
    const keys = [];
    for (const input of inputs) {
      const result = await validateEligibilityAddress(input, {
        token: "fixture-token",
        fetcher: provider(null),
      });
      expect(result.status).toBe("valid");
      if (result.status !== "valid") throw new Error("expected validated input");
      keys.push(
        deriveEligibilityKeys(
          "campaign-a",
          "sole",
          result.address,
          "specialty-test-secret-32-characters-minimum",
        ).addressKey,
      );
    }
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
  });
  test("rejects conflicting units even when a valid response has no recommendation", async () => {
    expect(
      await validateEligibilityAddress(
        { ...address, line1: "123 Main St Apt 5" },
        { token: "fixture-token", fetcher: provider(null) },
      ),
    ).toEqual({ status: "unavailable" });
  });
  test.each([
    [{}, "invalid"],
    [{ ...recommended, postal_code: null }, "invalid"],
    ["malformed recommendation", "unavailable"],
  ])(
    "never falls back from a present malformed recommendation %j",
    async (value, status) => {
      expect(
        await validateEligibilityAddress(address, {
          token: "fixture-token",
          fetcher: provider(value),
        }),
      ).toEqual({ status });
    },
  );
  test.each([null, "APT 5"])("rejects dropped or changed unit %s", async (unit) => {
    expect(
      await validateEligibilityAddress(address, {
        token: "fixture-token",
        fetcher: provider({ ...recommended, address_line_2: unit }),
      }),
    ).toEqual({ status: "invalid" });
  });
  test("requires explicit review for a high-confidence destination correction", async () => {
    const result = await validateEligibilityAddress(address, {
      token: "fixture-token",
      fetcher: provider(
        { ...recommended, address_line_1: "125 MAIN ST" },
        "partially_valid",
      ),
    });
    expect(result.status).toBe("correction_required");
    if (result.status === "correction_required")
      expect(result.address.line1).toBe("125 MAIN ST");
  });
  test("never authorizes unverifiable or unconfirmed partial addresses", async () => {
    expect(
      await validateEligibilityAddress(address, {
        token: "fixture-token",
        fetcher: provider(null, "partially_valid"),
      }),
    ).toEqual({ status: "invalid" });
    expect(
      await validateEligibilityAddress(address, {
        token: "fixture-token",
        fetcher: provider(null, "unknown"),
      }),
    ).toEqual({ status: "invalid" });
    expect(
      await validateEligibilityAddress(address, {
        token: "fixture-token",
        fetcher: provider(
          {
            ...recommended,
            address_line_1: "125 MAIN ST",
            confidence_result: { score: "low" },
          },
          "partially_valid",
        ),
      }),
    ).toEqual({ status: "invalid" });
  });
  test("handles throttling, malformed JSON and timeout without exposing provider details", async () => {
    const thrower = jest.fn().mockRejectedValue(new Error("private provider details"));
    const malformed = jest.fn().mockResolvedValue(new Response("not-json"));
    const missingVerdict = jest
      .fn()
      .mockResolvedValue(Response.json({ analysis: { validation_result: {} } }));
    for (const fetcher of [
      provider(recommended, "valid", 429),
      thrower,
      malformed,
      missingVerdict,
    ]) {
      expect(
        await validateEligibilityAddress(address, { token: "fixture-token", fetcher }),
      ).toEqual({ status: "unavailable" });
    }
  });
});
