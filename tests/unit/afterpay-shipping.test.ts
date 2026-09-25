import {
  afterpayShippingUpdate,
  matchesAfterpayAddress,
  matchesAfterpayTokenAddress,
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
  it.each([undefined, null, ""])(
    "uses confirmed geography only for missing token fields (%s)",
    (missing) => {
      const partial = { ...contact, state: missing, countryCode: missing };
      expect(matchesAfterpayTokenAddress(partial, address, true)).toBe(true);
      expect(matchesAfterpayTokenAddress(partial, address, false)).toBe(false);
      expect(matchesAfterpayTokenAddress(contact, address, false)).toBe(true);
    },
  );
  it.each([
    { state: "DE" },
    { countryCode: "CA" },
    { state: 42 },
    { addressLines: ["999 Main St", "Apt 2"] },
    { addressLines: ["123 Main St", "Apt 3"] },
    { addressLines: undefined },
    { city: "Other City" },
    { city: undefined },
    { postalCode: "90210" },
    { postalCode: "27101-5678" },
  ])(
    "rejects conflicting or incomplete token addresses despite confirmation: %j",
    (override) => {
      expect(
        matchesAfterpayTokenAddress(
          { ...contact, state: undefined, countryCode: undefined, ...override },
          address,
          true,
        ),
      ).toBe(false);
    },
  );
  it("requires this attempt's full confirmation when the token has no contact", () => {
    expect(matchesAfterpayTokenAddress(undefined, address, true)).toBe(true);
    expect(matchesAfterpayTokenAddress(undefined, address, false)).toBe(false);
    expect(matchesAfterpayTokenAddress({}, address, true)).toBe(false);
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
