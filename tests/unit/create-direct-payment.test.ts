import { createDirectPaymentHandler } from "@/lib/checkout/create-direct-payment";

function request() {
  return new Request("https://shop.example.com/api/checkout/pay", {
    method: "POST",
    body: JSON.stringify({ permit: "permit-1", sourceId: "cnon:card-nonce-ok" }),
  }) as never;
}

function dependencies() {
  return {
    consumePermit: jest.fn().mockResolvedValue({
      tenantId: "tenant-1",
      orderId: "order-1",
      cartHash: "cart-hash",
      totalCents: 11800,
      method: "card",
      deviceSessionId: "device-1",
      normalizedEmailHash: "email-hash",
      squareIdempotencyKey: "11111111-1111-4111-8111-111111111111",
    }),
    loadOrder: jest.fn().mockResolvedValue({
      orderId: "order-1",
      tenantId: "tenant-1",
      cartHash: "cart-hash",
      totalCents: 11800,
      status: "pending",
      expiresAt: "2026-09-06T12:15:00.000Z",
      squareOrderId: "square-order-1",
      deviceSessionId: "device-1",
      shippingAddress: null,
    }),
    createPayment: jest.fn().mockResolvedValue({
      id: "payment-1",
      orderId: "square-order-1",
      status: "COMPLETED",
      totalCents: 11800,
    }),
    savePaymentId: jest.fn().mockResolvedValue(undefined),
    recordDecline: jest
      .fn()
      .mockResolvedValue({ allowed: true, retryAfterSeconds: null }),
    isDefiniteDecline: jest.fn().mockReturnValue(false),
    reportError: jest.fn(),
    now: jest.fn(() => new Date("2026-09-06T12:00:00.000Z")),
  };
}

describe("createDirectPaymentHandler", () => {
  it("never contacts Square for a replayed permit", async () => {
    const deps = dependencies();
    deps.consumePermit.mockResolvedValue(null);
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(403);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });

  it("consumes and validates the permit before creating payment", async () => {
    const deps = dependencies();
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(202);
    expect(deps.consumePermit.mock.invocationCallOrder[0]).toBeLessThan(
      deps.createPayment.mock.invocationCallOrder[0],
    );
    expect(deps.savePaymentId).toHaveBeenCalledWith("order-1", "payment-1");
  });

  it("rejects a changed total without contacting Square", async () => {
    const deps = dependencies();
    deps.loadOrder.mockResolvedValue({ ...(await deps.loadOrder()), totalCents: 11900 });
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
});
