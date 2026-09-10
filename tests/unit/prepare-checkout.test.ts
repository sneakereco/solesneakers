import { prepareCheckoutHandler } from "@/lib/checkout/prepare-checkout";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID = "44444444-4444-4444-8444-444444444444";
const QUOTE_FINGERPRINT =
  "610ae04d8f9e17f9c643e5d21637d830251ddeedd427e1ac9a32d3947d3e649b";

function request(quoteFingerprint = QUOTE_FINGERPRINT) {
  return new Request("https://shop.example.com/api/checkout/prepare", {
    method: "POST",
    body: JSON.stringify({
      items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 }],
      fulfillment: "ship",
      idempotencyKey: IDEMPOTENCY_KEY,
      deviceSessionId: DEVICE_ID,
      quoteFingerprint,
      buyerEmail: "buyer@example.com",
      paymentMethod: "card",
      shippingAddress: {
        name: "Buyer",
        phone: "5555555555",
        line1: "1 Main Street",
        line2: null,
        city: "Charleston",
        state: "SC",
        postalCode: "29401",
        country: "US",
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
        country: "US",
      },
    }),
  }) as never;
}

function dependencies() {
  const item = {
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    quantity: 1,
    unitPriceCents: 10000,
    unitCostCents: 6000,
    lineTotalCents: 10000,
    variantSku: "SKU-1",
    productName: "Dunk Low",
    brand: "Nike",
    model: "Dunk",
    category: "shoes",
    condition: "new",
    sizeLabel: "10",
  };
  return {
    checkAddressValidationAttempt: jest
      .fn()
      .mockResolvedValue({ allowed: true, retryAfterSeconds: null }),
    validateShippingAddress: jest.fn().mockResolvedValue({ status: "valid" }),
    findTenantId: jest.fn().mockResolvedValue("tenant-1"),
    getAccess: jest.fn().mockResolvedValue({ open: true }),
    verifyBrowser: jest.fn().mockResolvedValue({ allowed: true, reason: "passed" }),
    getClientIp: jest.fn().mockReturnValue("203.0.113.2"),
    getSession: jest.fn().mockResolvedValue(null),
    hashEmail: jest.fn().mockReturnValue("email-hash"),
    findExisting: jest.fn().mockResolvedValue(null),
    checkAttempt: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: null }),
    resolveCart: jest.fn().mockResolvedValue({ items: [item], subtotalCents: 10000 }),
    quote: jest.fn().mockResolvedValue({
      shippingCents: 1000,
      taxCents: 0,
      taxCalculationId: "square:pending",
      customerState: "SC",
    }),
    calculateSquareOrder: jest.fn().mockResolvedValue({
      subtotalCents: 10000,
      shippingCents: 1000,
      taxCents: 800,
      totalCents: 11800,
    }),
    reserve: jest.fn().mockResolvedValue({
      orderId: "order-1",
      reused: false,
      expiresAt: "2026-09-06T12:15:00.000Z",
      squarePaymentLinkId: null,
      squareOrderId: null,
      squarePaymentLinkUrl: null,
    }),
    createGuestAccessToken: jest.fn().mockResolvedValue("guest-token"),
    getSquareClientConfig: jest.fn().mockReturnValue({
      applicationId: "sandbox-app-id",
      locationId: "location-1",
      environment: "sandbox",
    }),
    createSquareOrder: jest.fn().mockResolvedValue({
      id: "square-order-1",
      version: 1,
      subtotalCents: 10000,
      shippingCents: 1000,
      taxCents: 800,
      totalCents: 11800,
      taxCalculationId: "square:square-order-1:v1",
    }),
    attachSquareOrder: jest.fn().mockResolvedValue(undefined),
    cancelSquareOrder: jest.fn().mockResolvedValue(undefined),
    releaseReservation: jest.fn().mockResolvedValue(true),
    reportError: jest.fn(),
    now: jest.fn(() => new Date("2026-09-06T12:00:00.000Z")),
  };
}

describe("prepareCheckoutHandler", () => {
  it("reserves server-priced inventory and attaches Square authoritative tax", async () => {
    const deps = dependencies();
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        orderId: "order-1",
        guestAccessToken: "guest-token",
        totals: {
          subtotalCents: 10000,
          shippingCents: 1000,
          taxCents: 800,
          totalCents: 11800,
        },
      }),
    );
    expect(deps.attachSquareOrder).toHaveBeenCalledWith(
      "order-1",
      expect.objectContaining({ id: "square-order-1" }),
    );
    expect(deps.calculateSquareOrder.mock.invocationCallOrder[0]).toBeLessThan(
      deps.reserve.mock.invocationCallOrder[0],
    );
    expect(deps.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: "card",
        billingAddress: expect.objectContaining({
          givenName: "Buyer",
          familyName: "Example",
          postalCode: "29401",
          country: "US",
        }),
      }),
    );
  });

  it("does not reserve or contact Square when the daily limit is exhausted", async () => {
    const deps = dependencies();
    deps.checkAttempt.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(429);
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareOrder).not.toHaveBeenCalled();
  });

  it("rejects a stale exact quote before reserving inventory", async () => {
    const deps = dependencies();
    const response = await prepareCheckoutHandler(request("b".repeat(64)), deps);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Checkout totals changed. Review the updated total and try again.",
    });
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareOrder).not.toHaveBeenCalled();
  });

  it("cancels and releases when created Square totals change after calculation", async () => {
    const deps = dependencies();
    deps.createSquareOrder.mockResolvedValue({
      id: "square-order-1",
      version: 1,
      subtotalCents: 10000,
      shippingCents: 1000,
      taxCents: 801,
      totalCents: 11801,
      taxCalculationId: "square:square-order-1:v1",
    });

    const response = await prepareCheckoutHandler(request(), deps);

    expect(response.status).toBe(409);
    expect(deps.attachSquareOrder).not.toHaveBeenCalled();
    expect(deps.cancelSquareOrder).toHaveBeenCalledWith(
      "square-order-1",
      1,
      expect.any(String),
    );
    expect(deps.releaseReservation).toHaveBeenCalledWith(
      "order-1",
      "square_order_totals_changed",
    );
  });
});

describe("shipping deliverability gate", () => {
  it.each(["card", "afterpay", "cashAppPay", "applePay", "googlePay"])(
    "blocks invalid %s destinations before reservation or Square",
    async (paymentMethod) => {
      const deps = dependencies();
      deps.validateShippingAddress.mockResolvedValue({ status: "invalid" });
      const body = await (request() as Request).json();
      const response = await prepareCheckoutHandler(
        new Request("https://shop.example.com/api/checkout/prepare", {
          method: "POST",
          body: JSON.stringify({ ...body, paymentMethod }),
        }) as never,
        deps,
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "SHIPPING_ADDRESS_INVALID" });
      expect(deps.reserve).not.toHaveBeenCalled();
      expect(deps.calculateSquareOrder).not.toHaveBeenCalled();
      expect(deps.createSquareOrder).not.toHaveBeenCalled();
    },
  );
  it("returns a suggested address without reserving inventory", async () => {
    const deps = dependencies();
    const body = await (request() as Request).json();
    const suggestedAddress = { ...body.shippingAddress, line1: "1 Main St" };
    deps.validateShippingAddress.mockResolvedValue({
      status: "suggestion",
      address: suggestedAddress,
    });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "SHIPPING_ADDRESS_SUGGESTION",
      suggestedAddress,
    });
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.checkAttempt).not.toHaveBeenCalled();
  });
  it("fails closed when Shippo is unavailable", async () => {
    const deps = dependencies();
    deps.validateShippingAddress.mockResolvedValue({ status: "unavailable" });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "SHIPPING_ADDRESS_UNAVAILABLE" });
    expect(deps.reserve).not.toHaveBeenCalled();
  });
  it("checks shipping even when an existing order could be reused", async () => {
    const deps = dependencies();
    deps.findExisting.mockResolvedValue({ squareOrderId: "existing" });
    deps.validateShippingAddress.mockResolvedValue({ status: "invalid" });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(422);
  });
  it("stops rate-limited address checks before contacting Shippo", async () => {
    const deps = dependencies();
    deps.checkAddressValidationAttempt.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(deps.validateShippingAddress).not.toHaveBeenCalled();
    expect(deps.checkAttempt).not.toHaveBeenCalled();
  });
  it("skips Shippo for pickup", async () => {
    const deps = dependencies();
    const body = await (request() as Request).json();
    await prepareCheckoutHandler(
      new Request("https://shop.example.com/api/checkout/prepare", {
        method: "POST",
        body: JSON.stringify({ ...body, fulfillment: "pickup", shippingAddress: null }),
      }) as never,
      deps,
    );
    expect(deps.validateShippingAddress).not.toHaveBeenCalled();
  });
});
