import type { NextRequest } from "next/server";

import {
  createPaymentLinkHandler,
  type CreatePaymentLinkDependencies,
} from "@/lib/checkout/create-payment-link";

const body = {
  items: [
    {
      productId: "11111111-1111-4111-8111-111111111111",
      variantId: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
    },
  ],
  fulfillment: "pickup",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  deviceSessionId: "44444444-4444-4444-8444-444444444444",
  buyerEmail: "buyer@example.com",
};

function request(payload: unknown = body): NextRequest {
  return new Request("https://shop.example.com/api/checkout/payment-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }) as NextRequest;
}

function dependencies(): jest.Mocked<CreatePaymentLinkDependencies> {
  return {
    findTenantId: jest.fn().mockResolvedValue("tenant-1"),
    getAccess: jest.fn().mockResolvedValue({ open: true }),
    verifyBrowser: jest.fn().mockResolvedValue({ allowed: true, reason: "passed" }),
    getClientIp: jest.fn().mockReturnValue("203.0.113.0"),
    getSession: jest.fn().mockResolvedValue(null),
    hashEmail: jest.fn().mockReturnValue("email-hash"),
    findExisting: jest.fn().mockResolvedValue(null),
    checkAttempt: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: null }),
    resolveCart: jest.fn().mockResolvedValue({
      subtotalCents: 15000,
      items: [
        {
          productId: body.items[0].productId,
          variantId: body.items[0].variantId,
          quantity: 1,
          unitPriceCents: 15000,
          unitCostCents: 9000,
          lineTotalCents: 15000,
          variantSku: "SKU-1",
          productName: "Air Runner",
          brand: "Sole",
          model: "One",
          category: "sneakers",
          condition: "new",
          sizeLabel: "10",
        },
      ],
    }),
    quote: jest.fn().mockResolvedValue({
      shippingCents: 0,
      taxCents: 0,
      taxCalculationId: "square:pending",
      customerState: "SC",
    }),
    reserve: jest.fn().mockResolvedValue({
      orderId: "order-1",
      reused: false,
      expiresAt: "2026-08-28T03:15:00.000Z",
      squarePaymentLinkId: null,
      squareOrderId: null,
      squarePaymentLinkUrl: null,
    }),
    createGuestAccessToken: jest.fn().mockResolvedValue("guest-order-token"),
    createSquareLink: jest.fn().mockResolvedValue({
      id: "link-1",
      orderId: "square-order-1",
      url: "https://square.link/u/example",
      taxCents: 900,
      shippingCents: 0,
      totalCents: 15900,
      taxCalculationId: "square:square-order-1:v1",
    }),
    attachSquareLink: jest.fn().mockResolvedValue(undefined),
    deleteSquareLink: jest.fn().mockResolvedValue(undefined),
    markSquareLinkDeleted: jest.fn().mockResolvedValue(undefined),
    releaseReservation: jest.fn().mockResolvedValue(true),
    reportError: jest.fn(),
    now: jest.fn(() => new Date("2026-08-28T03:00:00.000Z")),
    siteUrl: "https://shop.example.com",
  };
}

describe("createPaymentLinkHandler", () => {
  it("stops at the kill switch before browser checks or Square", async () => {
    const deps = dependencies();
    deps.getAccess.mockResolvedValue({ open: false, message: "Checkout paused" });

    const response = await createPaymentLinkHandler(request(), deps);

    expect(response.status).toBe(503);
    expect(deps.verifyBrowser).not.toHaveBeenCalled();
    expect(deps.createSquareLink).not.toHaveBeenCalled();
  });

  it("rejects a bot before parsing or reserving inventory", async () => {
    const deps = dependencies();
    deps.verifyBrowser.mockResolvedValue({ allowed: false, reason: "bot" });

    const response = await createPaymentLinkHandler(request(), deps);

    expect(response.status).toBe(403);
    expect(deps.findExisting).not.toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareLink).not.toHaveBeenCalled();
  });

  it("reuses an unexpired hosted link before consuming quota", async () => {
    const deps = dependencies();
    deps.findExisting.mockImplementation((_tenant, _key, cartHash) =>
      Promise.resolve({
        orderId: "order-1",
        cartHash,
        status: "pending",
        expiresAt: "2026-08-28T03:15:00.000Z",
        subtotalCents: 15000,
        shippingCents: 0,
        taxCents: 900,
        totalCents: 15900,
        fulfillment: "pickup",
        guestEmail: "buyer@example.com",
        squarePaymentLinkId: "link-1",
        squareOrderId: "square-order-1",
        squarePaymentLinkUrl: "https://square.link/u/example",
        squarePaymentLinkDeletedAt: null,
        items: [],
      }),
    );

    const response = await createPaymentLinkHandler(request(), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reused: true,
      orderId: "order-1",
      guestAccessToken: "guest-order-token",
    });
    expect(deps.createGuestAccessToken).toHaveBeenCalledWith("order-1");
    expect(deps.checkAttempt).not.toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareLink).not.toHaveBeenCalled();
  });

  it("creates Square only after quota, pricing, and atomic reservation", async () => {
    const deps = dependencies();

    const response = await createPaymentLinkHandler(request(), deps);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      reused: false,
      orderId: "order-1",
      url: "https://square.link/u/example",
      guestAccessToken: "guest-order-token",
    });
    expect(deps.checkAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      deps.reserve.mock.invocationCallOrder[0],
    );
    expect(deps.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      deps.createSquareLink.mock.invocationCallOrder[0],
    );
    expect(deps.attachSquareLink).toHaveBeenCalledWith("order-1", {
      id: "link-1",
      orderId: "square-order-1",
      url: "https://square.link/u/example",
      taxCents: 900,
      shippingCents: 0,
      totalCents: 15900,
      taxCalculationId: "square:square-order-1:v1",
    });
  });

  it("does not create or return a guest token for an authenticated order", async () => {
    const deps = dependencies();
    deps.getSession.mockResolvedValue({
      user: { id: "user-1", email: "buyer@example.com" },
    });

    const response = await createPaymentLinkHandler(request(), deps);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.not.toHaveProperty("guestAccessToken");
    expect(deps.createGuestAccessToken).not.toHaveBeenCalled();
  });

  it("fails before reservation or Square when category pricing is unavailable", async () => {
    const deps = dependencies();
    deps.quote.mockRejectedValue(new Error("checkout_pricing_unavailable"));

    const response = await createPaymentLinkHandler(request(), deps);

    expect(response.status).toBe(503);
    expect(deps.quote).toHaveBeenCalled();
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareLink).not.toHaveBeenCalled();
  });

  it("releases inventory after deleting an unshared link when attach never persisted", async () => {
    const deps = dependencies();
    deps.attachSquareLink.mockRejectedValue(new Error("database unavailable"));
    deps.markSquareLinkDeleted.mockRejectedValue(
      new Error("link id was never attached locally"),
    );

    const response = await createPaymentLinkHandler(request(), deps);

    expect(response.status).toBe(503);
    expect(deps.deleteSquareLink).toHaveBeenCalledWith("link-1");
    expect(deps.releaseReservation).toHaveBeenCalledWith(
      "order-1",
      "square_link_attach_failed",
    );
  });
});
