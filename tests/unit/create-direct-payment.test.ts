import type {
  RecordOutcomeInput,
  PaymentAttempt,
} from "@/Modules/Checkout/Source/Features/Payments/attempt-contract";
import { createDirectPaymentHandler } from "@/lib/checkout/create-direct-payment";
import { validateShippingAddress } from "@/lib/shipping/validate-shipping-address";
import { PaymentPermitStore } from "@/lib/checkout/payment-permit";
import {
  futurePermitFixture,
  permitRedisFixture,
} from "@/Modules/Checkout/Tests/Features/ContractCompatibility/fixtures";

function request() {
  return new Request("https://shop.example.com/api/checkout/pay", {
    method: "POST",
    body: JSON.stringify({ permit: "permit-1", sourceId: "cnon:card-nonce-ok" }),
  }) as never;
}
it.each(["declined", "canceled"])(
  "observes a prior %s attempt with independently verified money under review",
  async (state) => {
    const deps = dependencies();
    const order = await deps.loadOrder();
    deps.loadOrder.mockResolvedValue({
      ...order,
      financialReview: "square_terminal_capture_conflict",
    });
    const at = await deps.readCurrentAttempt();
    deps.readCurrentAttempt.mockResolvedValue({
      ...at,
      state,
      providerPaymentId: "review-pay",
    });
    const res = await createDirectPaymentHandler(request(), deps);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      orderId: "order-1",
      status: "UNKNOWN",
      statusUrl: "/checkout/processing?orderId=order-1",
    });
    expect(deps.beginDispatch).not.toHaveBeenCalled();
    expect(deps.createPayment).not.toHaveBeenCalled();
  },
);

function dependencies() {
  const ready: PaymentAttempt = {
    id: "attempt-1",
    orderId: "order-1",
    sequence: 1,
    state: "ready",
    method: "card",
    amountCents: 11800,
    currency: "USD",
    squareIdempotencyKey: "11111111-1111-4111-8111-111111111111",
    providerPaymentId: null,
    requestDigest: null,
  };
  return {
    getSession: jest.fn().mockResolvedValue({ user: { id: "account-1" } }),
    getAccess: jest.fn().mockResolvedValue({ open: true }),
    enqueueLegacyInquiry: jest.fn().mockResolvedValue(undefined),
    readCurrentAttempt: jest.fn().mockResolvedValue(ready),
    beginDispatch: jest.fn().mockResolvedValue({
      kind: "dispatch",
      attempt: {
        id: "attempt-1",
        orderId: "order-1",
        method: "card",
        amountCents: 11800,
        squareIdempotencyKey: "11111111-1111-4111-8111-111111111111",
      },
    }),
    recordAttemptOutcome: jest.fn(
      (input: RecordOutcomeInput): Promise<PaymentAttempt> =>
        Promise.resolve({
          ...ready,
          state: input.state,
          providerPaymentId: input.providerPaymentId,
          requestDigest: "a".repeat(64),
        }),
    ),
    fingerprints: jest
      .fn()
      .mockReturnValue({ requestDigest: "a".repeat(64), sourceDigest: "b".repeat(64) }),
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
      userId: "account-1",
      squareOrderVersion: 1,
      orderId: "order-1",
      tenantId: "tenant-1",
      cartHash: "cart-hash",
      totalCents: 11800,
      status: "pending",
      expiresAt: "2026-09-06T12:15:00.000Z",
      squareOrderId: "square-order-1",
      deviceSessionId: "device-1",
      fulfillment: "pickup",
      pickupContact: { name: "Pickup Buyer", phone: "3365550100" },
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
    declineCode: jest.fn().mockReturnValue(null),
    reportError: jest.fn(),
    now: jest.fn(() => new Date("2026-09-06T12:00:00.000Z")),
  };
}

describe("createDirectPaymentHandler", () => {
  async function storeBackedDependencies(change: Record<string, unknown> = {}) {
    const deps = dependencies();
    const legacy = await deps.consumePermit();
    const redis = permitRedisFixture();
    redis.seed("permit-1", { ...futurePermitFixture(legacy), ...change });
    const store = new PaymentPermitStore(redis);
    return { ...deps, consumePermit: (token: string) => store.consume(token), redis };
  }

  it("charges once through a real v2 reader and preserves authorized idempotency/method", async () => {
    const deps = await storeBackedDependencies();
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      paymentId: "payment-1",
      status: "COMPLETED",
    });
    expect(deps.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        localOrderId: "order-1",
        squareOrderId: "square-order-1",
        totalCents: 11800,
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      }),
    );
    expect(deps.savePaymentId).toHaveBeenCalledWith(
      "order-1",
      "payment-1",
      expect.any(Object),
      "card",
    );
    const replay = await createDirectPaymentHandler(request(), deps);
    expect(replay.status).toBe(403);
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
  });

  it.each([
    { cartHash: "other" },
    { totalCents: 11801 },
    { deviceSessionId: "other" },
    { orderId: "other" },
  ])("rejects a v2 permit binding mismatch %j before Square", async (change) => {
    const deps = await storeBackedDependencies(change);
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });

  it.each([
    { status: "paid" },
    { expiresAt: "2026-09-06T12:00:00.000Z" },
    { squareOrderId: null },
    { billingAddress: null },
    { pickupContact: null },
  ])("preserves v2 stored order prerequisites %j", async (change) => {
    const deps = await storeBackedDependencies();
    deps.loadOrder.mockResolvedValue({ ...(await deps.loadOrder()), ...change });
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });

  it("does not charge an expired v2 permit", async () => {
    const deps = await storeBackedDependencies();
    deps.redis.advance(120000);
    expect((await createDirectPaymentHandler(request(), deps)).status).toBe(403);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });

  it.each(["FAILED", "exception"])(
    "keeps the loaded order's legacy decline counter for v2 %s",
    async (outcome) => {
      const deps = await storeBackedDependencies();
      deps.loadOrder.mockResolvedValue({
        ...(await deps.loadOrder()),
        tenantId: "authoritative-tenant",
      });
      if (outcome === "exception") {
        deps.createPayment.mockRejectedValue(new Error("declined"));
        deps.declineCode.mockReturnValue("CARD_DECLINED");
      } else {
        deps.createPayment.mockResolvedValue({
          ...(await deps.createPayment()),
          status: outcome,
        });
        deps.createPayment.mockClear();
      }
      expect((await createDirectPaymentHandler(request(), deps)).status).toBe(402);
      expect(deps.recordDecline).toHaveBeenCalledWith({
        tenantId: "authoritative-tenant",
        deviceSessionId: "device-1",
      });
      expect(deps.savePaymentId).not.toHaveBeenCalled();
    },
  );

  it("keeps v2 unknown-payment recovery without a second charge or decline", async () => {
    const deps = await storeBackedDependencies();
    deps.savePaymentId.mockRejectedValue(new Error("write failed"));
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: "UNKNOWN",
      statusUrl: "/checkout/processing?orderId=order-1",
    });
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(deps.recordDecline).not.toHaveBeenCalled();
  });

  it("still rejects legacy cross-tenant permits", async () => {
    const deps = dependencies();
    deps.loadOrder.mockResolvedValue({ ...(await deps.loadOrder()), tenantId: "other" });
    expect((await createDirectPaymentHandler(request(), deps)).status).toBe(409);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });

  it("does not charge a pickup order without a complete recipient", async () => {
    const deps = dependencies();
    deps.loadOrder.mockResolvedValue({
      ...(await deps.loadOrder()),
      pickupContact: null,
    });
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
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
    expect(deps.savePaymentId).toHaveBeenCalledWith(
      "order-1",
      "payment-1",
      expect.objectContaining({ id: "payment-1" }),
      "card",
    );
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
  it("charges an explicitly confirmed entered address without forcing the suggestion", async () => {
    const deps = dependencies();
    deps.loadOrder.mockResolvedValue({
      ...(await deps.loadOrder()),
      fulfillment: "ship",
      shippingAddressOverrideConfirmed: true,
      shippingAddress: {
        name: "Buyer",
        phone: "2025550100",
        line1: "1600 Pennsylvania Avenue NW",
        line2: null,
        city: "Washington",
        state: "DC",
        postalCode: "20500",
        country: "US",
      },
    });
    deps.validateShippingAddress.mockResolvedValue({
      status: "suggestion",
      address: {
        name: "Buyer",
        phone: "2025550100",
        line1: "1600 Pennsylvania Ave NW",
        line2: null,
        city: "Washington",
        state: "DC",
        postalCode: "20500-0005",
        country: "US",
      },
    });

    const response = await createDirectPaymentHandler(request(), deps);

    expect(response.status).toBe(202);
    expect(deps.validateShippingAddress).not.toHaveBeenCalled();
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
  });
  it.each(["applePay"])(
    "charges %s using the stored wallet address without Shippo",
    async (method) => {
      const deps = dependencies();
      deps.consumePermit.mockResolvedValue({ ...(await deps.consumePermit()), method });
      deps.readCurrentAttempt.mockResolvedValue({
        ...(await deps.readCurrentAttempt()),
        method,
      });
      deps.beginDispatch.mockResolvedValue({
        kind: "dispatch",
        attempt: await deps.readCurrentAttempt(),
      });
      const shippingAddress = {
        name: "Buyer",
        phone: "2025550100",
        line1: "1 Wallet St",
        line2: "Apt 3",
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
      deps.validateShippingAddress.mockRejectedValue(new Error("Shippo unavailable"));
      const response = await createDirectPaymentHandler(request(), deps);
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        paymentId: "payment-1",
        status: "COMPLETED",
      });
      expect(deps.validateShippingAddress).not.toHaveBeenCalled();
      expect(deps.createPayment).toHaveBeenCalledTimes(1);
      expect(deps.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ shippingAddress }),
      );
    },
  );
  it("blocks an unconfirmed card address formatting suggestion at the final payment gate", async () => {
    const deps = dependencies();
    const shippingAddress = {
      name: "Buyer",
      phone: "2025550100",
      line1: "1600 Pennsylvania Avenue NW",
      line2: "Apt 2",
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
    deps.validateShippingAddress.mockImplementation((address) =>
      validateShippingAddress(address, "test", () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              analysis: { validation_result: { value: "partially_valid" } },
              recommended_address: {
                address_line_1: "1600 Pennsylvania Ave NW",
                address_line_2: "Apt 2",
                city_locality: "Washington",
                state_province: "DC",
                postal_code: "20500-0005",
                country_code: "US",
                confidence_result: { score: "high" },
              },
            }),
          ),
        ),
      ),
    );
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(deps.createPayment).not.toHaveBeenCalled();
  });
  it.each(
    ["card", "afterpay", "cashAppPay"].flatMap((method) =>
      ["invalid", "suggestion", "unavailable"].map((status) => [method, status]),
    ),
  )(
    "blocks %s payments with %s stored destinations even with a previously issued permit",
    async (method, status) => {
      const deps = dependencies();
      deps.consumePermit.mockResolvedValue({ ...(await deps.consumePermit()), method });
      deps.readCurrentAttempt.mockResolvedValue({
        ...(await deps.readCurrentAttempt()),
        method,
      });
      deps.beginDispatch.mockResolvedValue({
        kind: "dispatch",
        attempt: await deps.readCurrentAttempt(),
      });
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

describe("payment attempt authorization and recovery", () => {
  it("checks the account session before reading the attempt or enqueuing inquiry", async () => {
    const deps = dependencies();
    deps.getSession.mockResolvedValue({ user: { id: "other-account" } });
    expect((await createDirectPaymentHandler(request(), deps)).status).toBe(403);
    expect(deps.readCurrentAttempt).not.toHaveBeenCalled();
    expect(deps.enqueueLegacyInquiry).not.toHaveBeenCalled();
  });
  it("rejects an unbound legacy guest bearer without exposing a ledger observation", async () => {
    const deps = dependencies();
    deps.loadOrder.mockResolvedValue({ ...(await deps.loadOrder()), userId: null });
    expect((await createDirectPaymentHandler(request(), deps)).status).toBe(403);
    expect(deps.readCurrentAttempt).not.toHaveBeenCalled();
    expect(deps.enqueueLegacyInquiry).not.toHaveBeenCalled();
  });
  it("enqueues order-scoped inquiry for a verified legacy account with no ledger row", async () => {
    const deps = dependencies();
    deps.readCurrentAttempt.mockResolvedValue(null);
    const result = await createDirectPaymentHandler(request(), deps);
    expect(result.status).toBe(202);
    const body = await result.json();
    expect(body).toMatchObject({ status: "UNKNOWN", orderId: "order-1" });
    expect(body).not.toHaveProperty("attemptId");
    expect(deps.enqueueLegacyInquiry).toHaveBeenCalledWith("order-1");
    expect(deps.beginDispatch).not.toHaveBeenCalled();
  });
  it("observes the committed claim after reload even if checkout closes or source is invalid", async () => {
    const deps = dependencies();
    deps.readCurrentAttempt.mockResolvedValue({
      ...(await deps.readCurrentAttempt()),
      state: "dispatch_started",
    });
    deps.getAccess.mockResolvedValue({ open: false, message: "Checkout closed" });
    const result = await createDirectPaymentHandler(
      new Request("https://shop.example.invalid", {
        method: "POST",
        body: JSON.stringify({ permit: "test", sourceId: "" }),
      }) as never,
      deps,
    );
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({
      status: "UNKNOWN",
      attemptId: "attempt-1",
    });
    expect(deps.createPayment).not.toHaveBeenCalled();
    expect(deps.getAccess).not.toHaveBeenCalled();
  });
  it("retains the current ready attempt when checkout is closed before claim", async () => {
    const deps = dependencies();
    deps.getAccess.mockResolvedValue({ open: false, message: "Checkout closed" });
    const result = await createDirectPaymentHandler(request(), deps);
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      code: "PAYMENT_NOT_SUBMITTED",
      error: "Checkout closed",
    });
    expect(deps.beginDispatch).not.toHaveBeenCalled();
  });
  it("keeps a consumed permit expired after an ambiguous provider response", async () => {
    const deps = dependencies(),
      redis = permitRedisFixture();
    redis.seed("permit-1", futurePermitFixture(await deps.consumePermit()));
    const bound = {
      ...deps,
      consumePermit: (token: string) => new PaymentPermitStore(redis).consume(token),
    };
    deps.createPayment.mockRejectedValue(new Error("timeout"));
    expect((await createDirectPaymentHandler(request(), bound)).status).toBe(202);
    redis.advance(120000);
    const retry = await createDirectPaymentHandler(request(), bound);
    expect(retry.status).toBe(403);
    expect(await retry.json()).not.toHaveProperty("code");
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(deps.beginDispatch).toHaveBeenCalledTimes(1);
  });
});

it("reports unavailable legacy inquiry without claiming the order is unpaid", async () => {
  const deps = dependencies();
  deps.readCurrentAttempt.mockResolvedValue(null);
  deps.enqueueLegacyInquiry.mockRejectedValue(new Error("database unavailable"));
  const response = await createDirectPaymentHandler(request(), deps);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    status: "UNKNOWN",
    statusUrl: "/checkout/processing?orderId=order-1",
  });
  expect(deps.beginDispatch).not.toHaveBeenCalled();
});

it.each([
  ["declined", "known-id", 402, "FAILED"],
  ["declined", null, 402, "FAILED"],
  ["canceled", "known-id", 402, "CANCELED"],
  ["succeeded", "known-id", 202, "COMPLETED"],
  ["pending", "known-id", 202, "PENDING"],
  ["review", "known-id", 202, "UNKNOWN"],
  ["unknown", null, 202, "UNKNOWN"],
  ["canceled", null, 202, "UNKNOWN"],
] as const)(
  "returns the authorized follower's %s result for %s without counting a second decline",
  async (state, providerPaymentId, status, httpPaymentStatus) => {
    const deps = dependencies();
    deps.readCurrentAttempt.mockResolvedValue({
      ...(await deps.readCurrentAttempt()),
      state,
      providerPaymentId,
      requestDigest:
        state === "canceled" && providerPaymentId === null ? null : "d".repeat(64),
    });
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({
      attemptId: "attempt-1",
      paymentId: providerPaymentId,
      status: httpPaymentStatus,
    });
    expect(deps.createPayment).not.toHaveBeenCalled();
    expect(deps.recordDecline).not.toHaveBeenCalled();
  },
);
it("uses a concurrent winner's latest verified outcome after losing the claim", async () => {
  const deps = dependencies(),
    initial = await deps.readCurrentAttempt(),
    latest = { ...initial, state: "declined", providerPaymentId: "known-id" };
  deps.readCurrentAttempt.mockResolvedValueOnce(initial).mockResolvedValueOnce(latest);
  deps.beginDispatch.mockResolvedValue({ kind: "observe", attempt: latest });
  const response = await createDirectPaymentHandler(request(), deps);
  expect(response.status).toBe(402);
  expect(await response.json()).toMatchObject({
    attemptId: "attempt-1",
    paymentId: "known-id",
    status: "FAILED",
  });
  expect(deps.recordDecline).not.toHaveBeenCalled();
  expect(deps.createPayment).not.toHaveBeenCalled();
});

it("counts a newly recorded decline once across the claimant and a later observer", async () => {
  const deps = dependencies(),
    ready = await deps.readCurrentAttempt();
  const declined = {
    ...ready,
    state: "declined" as const,
    providerPaymentId: "payment-1",
    requestDigest: "d".repeat(64),
  };
  deps.createPayment.mockResolvedValue({
    ...(await deps.createPayment()),
    status: "FAILED",
  });
  deps.createPayment.mockClear();
  deps.recordAttemptOutcome.mockResolvedValue(declined);
  deps.readCurrentAttempt.mockResolvedValueOnce(ready).mockResolvedValue(declined);
  for (let i = 0; i < 2; i++) {
    const response = await createDirectPaymentHandler(request(), deps);
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      status: "FAILED",
      paymentId: "payment-1",
      attemptId: "attempt-1",
    });
  }
  expect(deps.recordDecline).toHaveBeenCalledTimes(1);
  expect(deps.createPayment).toHaveBeenCalledTimes(1);
});

it("keeps a losing permit uncertain if the latest sequence cannot be verified", async () => {
  const deps = dependencies(),
    ready = await deps.readCurrentAttempt();
  deps.readCurrentAttempt
    .mockResolvedValueOnce(ready)
    .mockRejectedValueOnce(new Error("latest sequence unavailable"));
  deps.beginDispatch.mockResolvedValue({
    kind: "observe",
    attempt: { ...ready, state: "declined", providerPaymentId: "older-payment" },
  });
  const response = await createDirectPaymentHandler(request(), deps);
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ paymentId: null, status: "UNKNOWN" });
  expect(deps.recordDecline).not.toHaveBeenCalled();
});
