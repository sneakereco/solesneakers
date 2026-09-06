import { paymentLinkRequestSchema } from "@/lib/checkout/payment-link-request";

const item = {
  productId: "11111111-1111-4111-8111-111111111111",
  variantId: "22222222-2222-4222-8222-222222222222",
  quantity: 1,
};

const base = {
  items: [item],
  fulfillment: "pickup",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  deviceSessionId: "44444444-4444-4444-8444-444444444444",
  buyerEmail: " Buyer@Example.com ",
};

describe("paymentLinkRequestSchema", () => {
  it("accepts a strict pickup request and normalizes the buyer email", () => {
    const result = paymentLinkRequestSchema.parse(base);

    expect(result.buyerEmail).toBe("buyer@example.com");
    expect(result.fulfillment).toBe("pickup");
  });

  it("lets Square collect the shipping address", () => {
    const missingAddress = paymentLinkRequestSchema.safeParse({
      ...base,
      fulfillment: "ship",
    });
    const nonUsAddress = paymentLinkRequestSchema.safeParse({
      ...base,
      fulfillment: "ship",
      shippingAddress: {
        name: "Buyer",
        line1: "1 Main Street",
        city: "Toronto",
        state: "ON",
        postalCode: "M5V 1A1",
        country: "CA",
      },
    });

    expect(missingAddress.success).toBe(true);
    expect(nonUsAddress.success).toBe(false);
  });

  it("rejects duplicate variants and client-supplied totals", () => {
    const duplicate = paymentLinkRequestSchema.safeParse({
      ...base,
      items: [item, item],
    });
    const suppliedTotal = paymentLinkRequestSchema.safeParse({
      ...base,
      totalCents: 1,
    });

    expect(duplicate.success).toBe(false);
    expect(suppliedTotal.success).toBe(false);
  });
});
