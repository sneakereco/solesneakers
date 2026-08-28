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
  it("is stable across cart item ordering", () => {
    const input = {
      tenantId: "tenant-1",
      buyerEmail: "buyer@example.com",
      fulfillment: "pickup" as const,
      shippingAddress: null,
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
      shippingAddress: null,
      items: [first],
    });
    const otherBuyer = createCheckoutCartHash({
      tenantId: "tenant-1",
      buyerEmail: "other@example.com",
      fulfillment: "pickup",
      shippingAddress: null,
      items: [first],
    });

    expect(pickup).not.toBe(otherBuyer);
    expect(pickup).toMatch(/^[a-f0-9]{64}$/);
  });
});
