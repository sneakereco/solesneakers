import { createDirectPaymentHandler } from "@/lib/checkout/create-direct-payment";

function request() {
  return new Request("https://shop.example.com/api/checkout/pay", {
    method: "POST",
    body: JSON.stringify({ permit: "permit-1", sourceId: "cnon:card-nonce-ok" }),
  }) as never;
}

function dependencies() {
  return {
    validateShippingAddress: jest.fn().mockResolvedValue({ status: "valid" }),
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
      fulfillment: "pickup",
      shippingAddress: null,
      billingAddress: {
        line1: "2 Billing Street",
        line2: null,
        city: "Charleston",
        state: "SC",
        postalCode: "29402",
        country: "US",
      },
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
  it("rejects an older order without billing before contacting Square", async () => {
    const deps = dependencies();
    deps.loadOrder.mockResolvedValue({
      ...(await deps.loadOrder()),
      billingAddress: null,
    });
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
  it("directs a captured payment with a failed local write to recovery without charging again", async () => {
    const deps = dependencies();
    deps.savePaymentId.mockRejectedValue(new Error("database unavailable"));
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: "UNKNOWN",
      statusUrl: "/checkout/processing?orderId=order-1",
    });
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(deps.recordDecline).not.toHaveBeenCalled();
  });
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
    expect(deps.validateShippingAddress).not.toHaveBeenCalled();
    expect(deps.consumePermit.mock.invocationCallOrder[0]).toBeLessThan(
      deps.createPayment.mock.invocationCallOrder[0],
    );
    expect(deps.savePaymentId).toHaveBeenCalledWith("order-1", "payment-1");
    expect(deps.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        billingAddress: (await deps.loadOrder()).billingAddress,
      }),
    );
  });

  it("rejects a changed total without contacting Square", async () => {
    const deps = dependencies();
    deps.loadOrder.mockResolvedValue({ ...(await deps.loadOrder()), totalCents: 11900 });
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
});

describe("final shipping verification", () => {
  it.each(["invalid", "suggestion", "unavailable"])(
    "blocks %s stored destinations even with a previously issued permit",
    async (status) => {
      const deps = dependencies();
      deps.loadOrder.mockResolvedValue({
        ...(await deps.loadOrder()),
        fulfillment: "ship",
        shippingAddress: {
          name: "Buyer",
          phone: "2025550100",
          line1: "1 Main St",
          line2: null,
          city: "Washington",
          state: "DC",
          postalCode: "20500",
          country: "US",
        },
      });
      deps.validateShippingAddress.mockResolvedValue({ status });
      const response = await createDirectPaymentHandler(request(), deps);
      expect(response.status).toBe(status === "unavailable" ? 503 : 409);
      expect(deps.createPayment).not.toHaveBeenCalled();
      expect(deps.savePaymentId).not.toHaveBeenCalled();
    },
  );
});

it("charges an older shipping order only after validating the stored destination", async () => {
  const deps = dependencies();
  const shippingAddress = {
    name: "Buyer",
    phone: "2025550100",
    line1: "1 Main St",
    line2: null,
    city: "Washington",
    state: "DC",
    postalCode: "20500",
    country: "US",
  };
  deps.loadOrder.mockResolvedValue({
    ...(await deps.loadOrder()),
    fulfillment: "ship",
    shippingAddress,
  });
  const response = await createDirectPaymentHandler(request(), deps);
  expect(response.status).toBe(202);
  expect(deps.validateShippingAddress).toHaveBeenCalledWith(shippingAddress);
  expect(deps.validateShippingAddress.mock.invocationCallOrder[0]).toBeLessThan(
    deps.createPayment.mock.invocationCallOrder[0],
  );
  expect(deps.createPayment).toHaveBeenCalledWith(
    expect.objectContaining({ shippingAddress }),
  );
});
