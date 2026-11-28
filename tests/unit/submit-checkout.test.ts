import { submitCheckoutHandler } from "@/Modules/Checkout/Source/Features/Payments/submit-checkout";
import { NextRequest } from "next/server";

const preparation = {
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
  paymentMethod: "afterpay",
  quoteFingerprint: "a".repeat(64),
  buyerEmail: "buyer@example.com",
  shippingAddress: null,
  pickupContact: { name: "Buyer", phone: "5555555555" },
  billingAddress: {
    givenName: "Buyer",
    familyName: "Example",
    line1: "1 Main St",
    city: "Charleston",
    state: "SC",
    postalCode: "29401",
    country: "US",
  },
};
const order = {
  orderId: "55555555-5555-4555-8555-555555555555",
  totals: { subtotalCents: 1000, shippingCents: 0, taxCents: 0, totalCents: 1000 },
  guestAccessToken: "private-guest-token",
};
function request(extra = {}) {
  return new NextRequest("https://shop.example/api/checkout/submit", {
    method: "POST",
    headers: { cookie: "guest=bound", "x-forwarded-for": "203.0.113.2" },
    body: JSON.stringify({
      preparation,
      sourceId: "private-source",
      turnstileToken: "verified",
      ...extra,
    }),
  });
}
function fixture() {
  const events: string[] = [];
  const deps = {
    verify: jest.fn(() => {
      events.push("verify");
      return Promise.resolve(null);
    }),
    prepare: jest.fn((_req: NextRequest) => {
      events.push("claim");
      return Promise.resolve(Response.json(order, { status: 201 }));
    }),
    permit: jest.fn((_req: NextRequest) => {
      events.push("permit");
      return Promise.resolve(
        Response.json({ permit: "private-permit" }, { status: 201 }),
      );
    }),
    pay: jest.fn((_req: NextRequest) => {
      events.push("pay");
      return Promise.resolve(Response.json({ status: "COMPLETED" }));
    }),
    reportError: jest.fn(),
  };
  return { deps, events };
}
it("claims stock, issues a fresh permit, and dispatches in one request after verification", async () => {
  const { deps, events } = fixture();
  const result = await submitCheckoutHandler(request(), deps);
  expect(events).toEqual(["verify", "claim", "permit", "pay"]);
  expect(await deps.prepare.mock.calls[0][0].json()).toEqual(preparation);
  expect(deps.prepare.mock.calls[0][0].headers.get("cookie")).toBe("guest=bound");
  expect(await deps.permit.mock.calls[0][0].json()).toMatchObject({
    orderId: order.orderId,
    method: "afterpay",
    turnstileToken: "verified",
  });
  expect(await deps.pay.mock.calls[0][0].json()).toEqual({
    permit: "private-permit",
    sourceId: "private-source",
  });
  const body = await result.json();
  expect(body).toMatchObject({
    ...order,
    paymentResult: { status: 200, body: { status: "COMPLETED" } },
  });
  expect(JSON.stringify(body)).not.toMatch(/private-source|private-permit/);
});
it("refuses an unavailable unit before issuing a permit or charging", async () => {
  const { deps } = fixture();
  deps.prepare.mockResolvedValueOnce(
    Response.json(
      { code: "INVENTORY_CONFLICT", paymentState: "not_submitted" },
      { status: 409 },
    ),
  );
  expect((await submitCheckoutHandler(request(), deps)).status).toBe(409);
  expect(deps.pay).not.toHaveBeenCalled();
  expect(deps.permit).not.toHaveBeenCalled();
});
it("refuses expired guest verification before claiming stock", async () => {
  const { deps } = fixture();
  deps.verify.mockResolvedValueOnce(
    Response.json({ error: "Checkout verification failed" }, { status: 403 }) as never,
  );
  expect((await submitCheckoutHandler(request(), deps)).status).toBe(403);
  expect(deps.prepare).not.toHaveBeenCalled();
});
it("preserves the order reference when permit issuance fails without dispatch", async () => {
  const { deps } = fixture();
  deps.permit.mockResolvedValueOnce(
    Response.json({ error: "Unavailable" }, { status: 503 }),
  );
  const body = await (await submitCheckoutHandler(request(), deps)).json();
  expect(body).toMatchObject({
    orderId: order.orderId,
    paymentResult: { status: 503, body: { code: "PAYMENT_NOT_SUBMITTED" } },
  });
  expect(deps.pay).not.toHaveBeenCalled();
});
it("keeps a dispatched ambiguous result for original-order recovery", async () => {
  const { deps } = fixture();
  deps.pay.mockRejectedValueOnce(new Error("PRIVATE provider data"));
  const body = await (await submitCheckoutHandler(request(), deps)).json();
  expect(body).toMatchObject({
    orderId: order.orderId,
    paymentResult: { status: 503, body: { status: "UNKNOWN" } },
  });
  expect(JSON.stringify(body)).not.toContain("PRIVATE");
});
it("never dispatches when preparation requires observation of the original order", async () => {
  const { deps } = fixture();
  deps.prepare.mockResolvedValueOnce(
    Response.json({ ...order, code: "CHECKOUT_RECOVERY_REQUIRED" }),
  );
  const body = await (await submitCheckoutHandler(request(), deps)).json();
  expect(body.code).toBe("CHECKOUT_RECOVERY_REQUIRED");
  expect(deps.permit).not.toHaveBeenCalled();
  expect(deps.pay).not.toHaveBeenCalled();
});
it("rejects recovery-only and malformed submissions before claiming", async () => {
  const { deps } = fixture();
  expect(
    (
      await submitCheckoutHandler(
        request({ preparation: { ...preparation, recoveryOnly: true } }),
        deps,
      )
    ).status,
  ).toBe(400);
  expect((await submitCheckoutHandler(request({ sourceId: "" }), deps)).status).toBe(400);
  expect(deps.prepare).not.toHaveBeenCalled();
});

it("treats a permit outage for a reused order as an unknown original payment", async () => {
  const { deps } = fixture();
  deps.prepare.mockResolvedValueOnce(Response.json({ ...order, reused: true }));
  deps.permit.mockResolvedValueOnce(
    Response.json({ error: "Unavailable" }, { status: 503 }),
  );
  const body = await (await submitCheckoutHandler(request(), deps)).json();
  expect(body.paymentResult).toEqual({
    status: 503,
    body: { error: "Unavailable", status: "UNKNOWN" },
  });
  expect(deps.pay).not.toHaveBeenCalled();
});
