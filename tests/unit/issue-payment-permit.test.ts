import { issuePaymentPermitHandler } from "@/lib/checkout/issue-payment-permit";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "22222222-2222-4222-8222-222222222222";

function request(body: Record<string, unknown>) {
  return new Request("https://shop.example.com/api/checkout/payment-permit", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

function dependencies() {
  return {
    findTenantId: jest.fn().mockResolvedValue("tenant-1"),
    getAccess: jest.fn().mockResolvedValue({ open: true }),
    verifyBrowser: jest.fn().mockResolvedValue({ allowed: true, reason: "passed" }),
    getClientIp: jest.fn().mockReturnValue("203.0.113.2"),
    getSession: jest.fn().mockResolvedValue(null),
    loadOrder: jest.fn().mockResolvedValue({
      orderId: ORDER_ID,
      tenantId: "tenant-1",
      userId: null,
      guestEmail: "buyer@example.com",
      cartHash: "cart-hash",
      status: "pending",
      expiresAt: "2026-09-06T12:15:00.000Z",
      totalCents: 11800,
      squareOrderId: "square-order-1",
      squareOrderVersion: 2,
      deviceSessionId: DEVICE_ID,
    }),
    validateGuestAccess: jest.fn().mockResolvedValue(true),
    verifyTurnstile: jest.fn().mockResolvedValue({ allowed: true, reason: "passed" }),
    checkPaymentAttempt: jest
      .fn()
      .mockResolvedValue({ allowed: true, retryAfterSeconds: null }),
    hashEmail: jest.fn().mockReturnValue("email-hash"),
    issuePermit: jest
      .fn()
      .mockResolvedValue({ token: "permit-1", expiresInSeconds: 120 }),
    reportError: jest.fn(),
    now: jest.fn(() => new Date("2026-09-06T12:00:00.000Z")),
  };
}

describe("issuePaymentPermitHandler", () => {
  it("does not issue a permit when guest Turnstile fails", async () => {
    const deps = dependencies();
    deps.verifyTurnstile.mockResolvedValue({ allowed: false, reason: "invalid" });

    const response = await issuePaymentPermitHandler(
      request({
        orderId: ORDER_ID,
        guestAccessToken: "guest-token",
        deviceSessionId: DEVICE_ID,
        method: "card",
        turnstileToken: "bad",
      }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.issuePermit).not.toHaveBeenCalled();
  });

  it("binds a guest permit to the reloaded order and identity", async () => {
    const deps = dependencies();
    const response = await issuePaymentPermitHandler(
      request({
        orderId: ORDER_ID,
        guestAccessToken: "guest-token",
        deviceSessionId: DEVICE_ID,
        method: "afterpay",
        turnstileToken: "turnstile",
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.issuePermit).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      orderId: ORDER_ID,
      cartHash: "cart-hash",
      totalCents: 11800,
      method: "afterpay",
      deviceSessionId: DEVICE_ID,
      normalizedEmailHash: "email-hash",
      squareIdempotencyKey: expect.any(String),
    });
  });
});
