import {
  issueShippingConfirmation,
  verifyShippingConfirmation,
} from "@/lib/checkout/shipping-address-confirmation";

const now = new Date("2026-09-14T12:00:00Z");
const secret = "test-secret-that-is-not-used-in-production";
const scope = {
  tenantId: "tenant",
  deviceSessionId: "device",
  normalizedEmailHash: "buyer",
  paymentMethod: "card",
  address: {
    name: "Buyer",
    phone: "2025550100",
    line1: "1 Main St",
    line2: "Apt 2",
    city: "Washington",
    state: "DC",
    postalCode: "20500",
    country: "US" as const,
  },
};

it("accepts only the signed destination and checkout identity within ten minutes", () => {
  const token = issueShippingConfirmation(scope, secret, now);
  expect(verifyShippingConfirmation(token, scope, secret, now)).toBe(true);
  for (const change of [
    { tenantId: "other" },
    { deviceSessionId: "other" },
    { normalizedEmailHash: "other" },
    { paymentMethod: "googlePay" },
    { address: { ...scope.address, line2: "Apt 3" } },
  ]) {
    expect(verifyShippingConfirmation(token, { ...scope, ...change }, secret, now)).toBe(
      false,
    );
  }
  expect(verifyShippingConfirmation(token, scope, "wrong-secret", now)).toBe(false);
  expect(
    verifyShippingConfirmation(token, scope, secret, new Date(now.getTime() + 600000)),
  ).toBe(false);
  expect(verifyShippingConfirmation(token + "x", scope, secret, now)).toBe(false);
  expect(verifyShippingConfirmation("forged", scope, secret, now)).toBe(false);
});
