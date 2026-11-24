import {
  issueShippingConfirmation,
  verifyShippingConfirmation,
} from "@/lib/checkout/shipping-address-confirmation";
import { futureShippingFixture } from "./fixtures";

const now = new Date("2026-09-14T12:00:00Z");
const secret = "test-shipping-secret";
const scope = {
  tenantId: "legacy-tenant",
  deviceSessionId: "device",
  normalizedEmailHash: "email",
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

describe("shipping confirmation compatibility reader", () => {
  it("reads an old-code frozen v1 token and preserves byte-identical issuance", () => {
    const token =
      "1789387800000.1492becfe861f9db8c1ec37020141ebd2cb53f05a98345019c462907aac666aa";
    expect(verifyShippingConfirmation(token, scope, secret, now)).toBe(true);
    expect(issueShippingConfirmation(scope, secret, now)).toBe(token);
  });
  it("reads explicit tenant-free v2 while production issuance stays v1", () => {
    const future = futureShippingFixture(scope, secret, now.getTime() + 600000);
    expect(verifyShippingConfirmation(future, scope, secret, now)).toBe(true);
    expect(
      verifyShippingConfirmation(future, { ...scope, tenantId: "other" }, secret, now),
    ).toBe(true);
    const legacy = issueShippingConfirmation(scope, secret, now);
    expect(legacy).toMatch(/^\d{13}\.[a-f0-9]{64}$/);
    expect(verifyShippingConfirmation(legacy, scope, secret, now)).toBe(true);
    expect(
      verifyShippingConfirmation(legacy, { ...scope, tenantId: "other" }, secret, now),
    ).toBe(false);
  });

  it.each([
    { deviceSessionId: "other" },
    { normalizedEmailHash: "other" },
    { paymentMethod: "applePay" },
    { address: { ...scope.address, line1: "2 Main St" } },
  ])("rejects changed v2 binding %j", (change) => {
    const token = futureShippingFixture(scope, secret, now.getTime() + 600000);
    expect(verifyShippingConfirmation(token, { ...scope, ...change }, secret, now)).toBe(
      false,
    );
  });

  it("rejects expired, oversized lifetime, unknown versions, tampering and wrong secrets", () => {
    const expires = now.getTime() + 600000;
    const token = futureShippingFixture(scope, secret, expires);
    expect(verifyShippingConfirmation(token, scope, secret, new Date(expires))).toBe(
      false,
    );
    expect(
      verifyShippingConfirmation(
        futureShippingFixture(scope, secret, expires + 1),
        scope,
        secret,
        now,
      ),
    ).toBe(false);
    expect(
      verifyShippingConfirmation(token.replace("v2.", "v3."), scope, secret, now),
    ).toBe(false);
    expect(verifyShippingConfirmation(token.replace("v2.", ""), scope, secret, now)).toBe(
      false,
    );
    expect(verifyShippingConfirmation(token + "x", scope, secret, now)).toBe(false);
    expect(verifyShippingConfirmation(token, scope, "wrong", now)).toBe(false);
  });
});
