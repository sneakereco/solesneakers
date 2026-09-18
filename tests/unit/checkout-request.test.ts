import {
  checkoutQuoteRequestSchema,
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
  paymentMethod: "card",
  billingAddress: {
    givenName: "Buyer",
    familyName: "Example",
    phone: null,
    line1: "1 Billing Street",
    line2: null,
    city: "Charleston",
    state: "SC",
    postalCode: "29401",
    country: "US",
  },
  quoteFingerprint: "a".repeat(64),
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

const billingAddress = {
  givenName: "Buyer",
  familyName: "Example",
  phone: null,
  line1: "1 Billing Street",
  line2: null,
  city: "Charleston",
  state: "sc",
  postalCode: "29401",
  country: "us",
};

describe("direct checkout request schemas", () => {
  it.each(["ship", "pickup"])("rejects Google Pay for %s checkout", (fulfillment) => {
    expect(
      prepareCheckoutRequestSchema.safeParse({
        ...base,
        fulfillment,
        shippingAddress: fulfillment === "ship" ? base.shippingAddress : null,
        pickupContact:
          fulfillment === "pickup" ? { name: "Buyer", phone: "3365550100" } : null,
        paymentMethod: "googlePay",
      }).success,
    ).toBe(false);
  });

  it("rejects Google Pay payment authorization requests", () => {
    expect(
      paymentPermitRequestSchema.safeParse({
        orderId: "55555555-5555-4555-8555-555555555555",
        deviceSessionId: base.deviceSessionId,
        method: "googlePay",
      }).success,
    ).toBe(false);
  });
  it("requires a valid pickup recipient independently of billing", () => {
    const pickup = { ...base, fulfillment: "pickup", shippingAddress: null };
    expect(prepareCheckoutRequestSchema.safeParse(pickup).success).toBe(false);
    expect(
      prepareCheckoutRequestSchema.safeParse({
        ...pickup,
        pickupContact: { name: "Pickup Buyer", phone: "not-a-phone" },
      }).success,
    ).toBe(false);
    expect(
      prepareCheckoutRequestSchema.parse({
        ...pickup,
        pickupContact: { name: " Pickup Buyer ", phone: "3365550100" },
      }).pickupContact,
    ).toEqual({ name: "Pickup Buyer", phone: "3365550100" });
  });
  it.each(["card", "afterpay", "cashAppPay", "applePay"])(
    "requires and normalizes billing for %s checkout",
    (paymentMethod) => {
      const card = prepareCheckoutRequestSchema.parse({
        ...base,
        paymentMethod,
        billingAddress,
      });

      expect(card.billingAddress).toMatchObject({ state: "SC", country: "US" });
      expect(
        prepareCheckoutRequestSchema.safeParse({
          ...base,
          paymentMethod,
          billingAddress: null,
        }).success,
      ).toBe(false);
    },
  );

  it("accepts a redacted wallet destination for an exact shipping quote", () => {
    expect(
      checkoutQuoteRequestSchema.parse({
        items: [item],
        fulfillment: "ship",
        shippingAddress: {
          state: "de",
          postalCode: "19801",
          country: "us",
        },
      }),
    ).toMatchObject({
      shippingAddress: {
        state: "DE",
        postalCode: "19801",
        country: "US",
      },
    });
  });

  it("accepts an address-free preliminary shipping quote", () => {
    const result = checkoutQuoteRequestSchema.parse({
      items: [item],
      fulfillment: "ship",
      shippingAddress: null,
    });

    expect(result).toEqual({
      items: [item],
      fulfillment: "ship",
      shippingAddress: null,
    });
  });

  it("rejects a shipping address for a pickup quote", () => {
    expect(
      checkoutQuoteRequestSchema.safeParse({
        items: [item],
        fulfillment: "pickup",
        shippingAddress: base.shippingAddress,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate variants in a quote", () => {
    expect(
      checkoutQuoteRequestSchema.safeParse({
        items: [item, item],
        fulfillment: "ship",
        shippingAddress: null,
      }).success,
    ).toBe(false);
  });

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
        pickupContact: { name: "Pickup Buyer", phone: "3365550100" },
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

  it("requires a lowercase SHA-256 quote fingerprint for prepare", () => {
    expect(
      prepareCheckoutRequestSchema.safeParse({
        ...base,
        quoteFingerprint: undefined,
      }).success,
    ).toBe(false);
    expect(
      prepareCheckoutRequestSchema.safeParse({
        ...base,
        quoteFingerprint: "not-a-fingerprint",
      }).success,
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
