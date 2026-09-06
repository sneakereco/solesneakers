import {
  directPaymentRequestSchema,
  paymentPermitRequestSchema,
  prepareCheckoutRequestSchema,
} from "@/lib/checkout/checkout-request";

const item = {
  productId: "11111111-1111-4111-8111-111111111111",
  variantId: "22222222-2222-4222-8222-222222222222",
  quantity: 1,
};

const base = {
  items: [item],
  fulfillment: "ship",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  deviceSessionId: "44444444-4444-4444-8444-444444444444",
  buyerEmail: " Buyer@Example.com ",
  shippingAddress: {
    name: "Buyer Example",
    phone: "8435550100",
    line1: "1 Main Street",
    line2: null,
    city: "Charleston",
    state: "sc",
    postalCode: "29401",
    country: "us",
  },
};

describe("direct checkout request schemas", () => {
  it("accepts and normalizes a complete shipping checkout", () => {
    const result = prepareCheckoutRequestSchema.parse(base);

    expect(result.buyerEmail).toBe("buyer@example.com");
    expect(result.shippingAddress?.state).toBe("SC");
    expect(result.shippingAddress?.country).toBe("US");
  });

  it("requires a complete shipping address for shipping and none for pickup", () => {
    expect(
      prepareCheckoutRequestSchema.safeParse({ ...base, shippingAddress: null }).success,
    ).toBe(false);
    expect(
      prepareCheckoutRequestSchema.safeParse({
        ...base,
        fulfillment: "pickup",
        shippingAddress: null,
      }).success,
    ).toBe(true);
    expect(
      prepareCheckoutRequestSchema.safeParse({ ...base, fulfillment: "pickup" }).success,
    ).toBe(false);
  });

  it("rejects client totals and duplicate variants", () => {
    expect(
      prepareCheckoutRequestSchema.safeParse({ ...base, totalCents: 1 }).success,
    ).toBe(false);
    expect(
      prepareCheckoutRequestSchema.safeParse({ ...base, items: [item, item] }).success,
    ).toBe(false);
  });

  it("accepts only identity and challenge data for a permit", () => {
    const request = {
      orderId: "55555555-5555-4555-8555-555555555555",
      guestAccessToken: "guest-token",
      deviceSessionId: base.deviceSessionId,
      method: "afterpay",
      turnstileToken: "challenge-token",
    };

    expect(paymentPermitRequestSchema.parse(request)).toEqual(request);
    expect(
      paymentPermitRequestSchema.safeParse({ ...request, totalCents: 1 }).success,
    ).toBe(false);
  });

  it("accepts only a permit and one-use Square source token for payment", () => {
    expect(
      directPaymentRequestSchema.parse({
        permit: "permit-token",
        sourceId: "cnon:card-nonce-ok",
      }),
    ).toEqual({ permit: "permit-token", sourceId: "cnon:card-nonce-ok" });
    expect(
      directPaymentRequestSchema.safeParse({
        permit: "permit-token",
        sourceId: "cnon:card-nonce-ok",
        totalCents: 1,
      }).success,
    ).toBe(false);
  });
});
