import { matchesCheckoutCartHash } from "@/Modules/Checkout/Source/Features/ContractCompatibility/cart-hash-reader";
import { createCheckoutCartHash } from "@/lib/checkout/checkout-cart-hash";
import { futureCartHashFixture } from "./fixtures";

const input = {
  tenantId: "tenant-1",
  buyerEmail: "buyer@example.com",
  fulfillment: "pickup" as const,
  paymentMethod: "applePay" as const,
  shippingAddress: null,
  billingAddress: null,
  pickupContact: { name: "Pickup Buyer", phone: "3365550100" },
  items: [
    {
      productId: "11111111-1111-4111-8111-111111111111",
      variantId: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
    },
  ],
};
const legacyHash = "27233e319239bcfa6cd8a7dd6df20b8a0d955472a438b1ca5bf9d529be70d142";
const futureHash = "02bfdb770b2ea68398a6ba367d5913a3817ec2a5abfe36450905ab0fd5665442";

describe("cart hash compatibility reader", () => {
  it("reads frozen v3/v4 artifacts while production issuance stays byte-identical v3", () => {
    expect(createCheckoutCartHash(input)).toBe(legacyHash);
    expect(
      matchesCheckoutCartHash(legacyHash, createCheckoutCartHash(input), input),
    ).toBe(true);
    expect(
      matchesCheckoutCartHash(futureHash, createCheckoutCartHash(input), input),
    ).toBe(true);
    expect(futureCartHashFixture(input)).toBe(futureHash);
  });

  it("excludes tenancy only for v4 identity", () => {
    const changed = { ...input, tenantId: "other" };
    expect(
      matchesCheckoutCartHash(futureHash, createCheckoutCartHash(changed), changed),
    ).toBe(true);
    expect(
      matchesCheckoutCartHash(legacyHash, createCheckoutCartHash(changed), changed),
    ).toBe(false);
  });

  it.each([
    { buyerEmail: "other@example.com" },
    { fulfillment: "ship" as const },
    { paymentMethod: "card" as const },
    { pickupContact: { name: "Another Buyer", phone: "3365550100" } },
    { pickupContact: { name: "Pickup Buyer", phone: "3365550101" } },
    { items: [{ ...input.items[0], quantity: 2 }] },
    { items: [{ ...input.items[0], variantId: "33333333-3333-4333-8333-333333333333" }] },
  ])("rejects changed v4 identity %j", (change) => {
    const changed = { ...input, ...change };
    expect(
      matchesCheckoutCartHash(futureHash, createCheckoutCartHash(changed), changed),
    ).toBe(false);
  });

  it("matches v4 item ordering without weakening quantity identity", () => {
    const second = {
      ...input.items[0],
      productId: "33333333-3333-4333-8333-333333333333",
      quantity: 2,
    };
    const stored = futureCartHashFixture({ ...input, items: [...input.items, second] });
    const reversed = { ...input, items: [second, ...input.items] };
    expect(
      matchesCheckoutCartHash(stored, createCheckoutCartHash(reversed), reversed),
    ).toBe(true);
    expect(
      matchesCheckoutCartHash("f".repeat(64), createCheckoutCartHash(reversed), reversed),
    ).toBe(false);
  });
});
