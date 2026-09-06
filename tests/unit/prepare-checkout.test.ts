import { prepareCheckoutHandler } from "@/lib/checkout/prepare-checkout";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID = "44444444-4444-4444-8444-444444444444";

function request() {
  return new Request("https://shop.example.com/api/checkout/prepare", {
    method: "POST",
    body: JSON.stringify({
      items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 }],
      fulfillment: "ship",
      idempotencyKey: IDEMPOTENCY_KEY,
      deviceSessionId: DEVICE_ID,
      buyerEmail: "buyer@example.com",
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
    reserve: jest.fn().mockResolvedValue({
      orderId: "order-1",
      reused: false,
      expiresAt: "2026-09-06T12:15:00.000Z",
      squarePaymentLinkId: null,
      squareOrderId: null,
      squarePaymentLinkUrl: null,
    }),
    createGuestAccessToken: jest.fn().mockResolvedValue("guest-token"),
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
  });

  it("does not reserve or contact Square when the daily limit is exhausted", async () => {
    const deps = dependencies();
    deps.checkAttempt.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(429);
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareOrder).not.toHaveBeenCalled();
  });
});
