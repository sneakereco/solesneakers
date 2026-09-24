import {
  afterpayAddressDiagnostic,
  afterpayShippingUpdate,
  matchesAfterpayAddress,
} from "@/components/checkout/afterpay-shipping";

const address = {
  name: "Test Buyer",
  phone: "3365550100",
  line1: "123 Main St",
  line2: "Apt 2",
  city: "Winston-Salem",
  state: "NC",
  postalCode: "27101-1234",
  country: "US" as const,
};
const contact = {
  addressLines: ["123 MAIN ST.", "APT 2"],
  city: "Winston-Salem",
  state: "North Carolina",
  postalCode: "27101",
  countryCode: "us",
};
const quote = {
  completeness: "exact" as const,
  quoteFingerprint: "a".repeat(64),
  totals: { subtotalCents: 10000, shippingCents: 1000, taxCents: 800, totalCents: 11800 },
};

describe("Afterpay shipping contract", () => {
  it("reports missing and mismatched fields without exposing contact or token data", () => {
    const result = afterpayAddressDiagnostic(
      {
        ...contact,
        addressLines: ["123 Main St", "2"],
        token: "private-token",
        email: "private@example.com",
      },
      address,
    );
    expect(result).toEqual({
      contactPresent: true,
      expectedPresent: true,
      missingFields: [],
      mismatchedFields: ["line2"],
      fullAddressMatches: false,
      redactedAddressMatches: false,
    });
    expect(
      afterpayAddressDiagnostic(
        { countryCode: "US", state: "NC", postalCode: "27101" },
        address,
      ),
    ).toEqual({
      contactPresent: true,
      expectedPresent: true,
      missingFields: ["addressLines", "city"],
      mismatchedFields: ["line1", "line2", "city"],
      fullAddressMatches: false,
      redactedAddressMatches: true,
    });
    expect(afterpayAddressDiagnostic(undefined, address).contactPresent).toBe(false);
    expect(afterpayAddressDiagnostic(contact, null).expectedPresent).toBe(false);
    expect(afterpayAddressDiagnostic(contact, address).fullAddressMatches).toBe(true);
  });
  it("accepts equivalent ZIP/state formatting while preserving apartment and street identity", () => {
    expect(matchesAfterpayAddress(contact, address)).toBe(true);
    expect(
      matchesAfterpayAddress(
        { ...contact, addressLines: ["999 Main St", "Apt 2"] },
        address,
      ),
    ).toBe(false);
    expect(
      matchesAfterpayAddress({ ...contact, addressLines: ["123 Main St"] }, address),
    ).toBe(false);
    expect(
      matchesAfterpayAddress({ ...contact, postalCode: "27101-5678" }, address),
    ).toBe(false);
    expect(matchesAfterpayAddress({ ...contact, countryCode: "CA" }, address)).toBe(
      false,
    );
  });
  it("allows a redacted quote callback but never treats it as a verified full destination", () => {
    const redacted = { countryCode: "US", state: "NC", postalCode: "27101" };
    expect(
      afterpayShippingUpdate(
        { fulfillment: "ship", quote, shippingAddress: address },
        redacted,
      ),
    ).toHaveProperty("shippingOptions.0.total.amount", "118.00");
    expect(matchesAfterpayAddress(redacted, address)).toBe(false);
    expect(
      afterpayShippingUpdate(
        { fulfillment: "ship", quote, shippingAddress: address },
        { ...redacted, postalCode: "90210" },
      ),
    ).toHaveProperty("error");
  });
  it("returns pickup without requiring a shipping address or charging shipping", () => {
    const pickupQuote = {
      ...quote,
      totals: { ...quote.totals, shippingCents: 0, totalCents: 10800 },
    };
    expect(
      afterpayShippingUpdate(
        { fulfillment: "pickup", quote: pickupQuote, shippingAddress: null },
        null,
      ),
    ).toHaveProperty(
      "shippingOptions.0",
      expect.objectContaining({ id: "PICKUP", amount: "0.00" }),
    );
    expect(afterpayShippingUpdate(null, contact)).toHaveProperty("error");
  });
});
