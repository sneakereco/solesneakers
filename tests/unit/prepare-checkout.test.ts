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
