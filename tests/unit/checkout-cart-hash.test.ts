import { createCheckoutCartHash } from "@/lib/checkout/checkout-cart-hash";

const first = {
  productId: "11111111-1111-4111-8111-111111111111",
  variantId: "22222222-2222-4222-8222-222222222222",
  quantity: 1,
};
const second = {
  productId: "33333333-3333-4333-8333-333333333333",
  variantId: "44444444-4444-4444-8444-444444444444",
  quantity: 2,
};

describe("createCheckoutCartHash", () => {
  it("binds card checkout identity to its billing address", () => {
    const input = {
      tenantId: "tenant-1",
      buyerEmail: "buyer@example.com",
      fulfillment: "ship" as const,
      paymentMethod: "card" as const,
      shippingAddress: {
        name: "Buyer Example",
        phone: "8435550100",
        line1: "1 Main Street",
        line2: null,
        city: "Charleston",
        state: "SC",
        postalCode: "29401",
        country: "US" as const,
      },
      billingAddress: {
        givenName: "Buyer",
        familyName: "Example",
        phone: null,
        line1: "1 Billing Street",
        line2: null,
        city: "Charleston",
        state: "SC",
        postalCode: "29401",
        country: "US" as const,
      },
      items: [first],
    };

    expect(createCheckoutCartHash(input)).not.toBe(
      createCheckoutCartHash({
        ...input,
        billingAddress: { ...input.billingAddress, postalCode: "29403" },
      }),
    );
  });

  it("is stable across cart item ordering", () => {
    const input = {
      tenantId: "tenant-1",
      buyerEmail: "buyer@example.com",
      fulfillment: "pickup" as const,
      paymentMethod: "applePay" as const,
      shippingAddress: null,
      billingAddress: null,
    };

    expect(createCheckoutCartHash({ ...input, items: [first, second] })).toBe(
      createCheckoutCartHash({ ...input, items: [second, first] }),
    );
  });

  it("binds the key to buyer and fulfillment details", () => {
    const pickup = createCheckoutCartHash({
      tenantId: "tenant-1",
      buyerEmail: "buyer@example.com",
      fulfillment: "pickup",
      paymentMethod: "applePay",
      shippingAddress: null,
      billingAddress: null,
      items: [first],
    });
    const otherBuyer = createCheckoutCartHash({
      tenantId: "tenant-1",
      buyerEmail: "other@example.com",
      fulfillment: "pickup",
      paymentMethod: "applePay",
      shippingAddress: null,
      billingAddress: null,
      items: [first],
    });

    expect(pickup).not.toBe(otherBuyer);
    expect(pickup).toMatch(/^[a-f0-9]{64}$/);
  });
});
