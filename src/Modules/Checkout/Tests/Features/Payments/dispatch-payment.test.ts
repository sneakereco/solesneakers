import { CheckoutPaymentAttemptRepository } from "../../../Source/Features/Payments/attempt-repository";
import { summarizeCheckoutEvents } from "../../../Source/Features/Operations/request-metrics";
import { SquarePaymentsGateway } from "@/lib/square/payments";
import type { DirectPaymentInput } from "@/lib/square/payments";
import { createDirectPaymentHandler } from "@/lib/checkout/create-direct-payment";
import { issuePaymentPermitHandler } from "@/lib/checkout/issue-payment-permit";
import { PaymentPermitStore } from "@/lib/checkout/payment-permit";
import { permitRedisFixture } from "../ContractCompatibility/fixtures";
import { dispatchPayment } from "@/Modules/Checkout/Source/Features/Payments/dispatch-payment";
import type {
  BeginDispatchInput,
  DispatchDecision,
  PaymentAttempt,
  RecordOutcomeInput,
} from "@/Modules/Checkout/Source/Features/Payments/attempt-contract";
import type { PaymentCheckout } from "@/repositories/checkout-reservation-repo";

const orderId = "ae6cf89e-10d4-49f4-b43a-a7ce79a16885",
  attemptId = "6bce9fd7-011c-4a13-bf85-76dcd9cb212f";
const key = "ebecfc40-b47b-435a-9c4f-f24769491217";
const permit = {
  orderId,
  attemptId,
  ownerBinding: "order:" + orderId,
  tenantId: "test",
  cartHash: "fixture",
  method: "card" as const,
  deviceSessionId: "device",
  totalCents: 1200,
  normalizedEmailHash: "hash",
  squareIdempotencyKey: key,
};
const order: PaymentCheckout = {
  orderId,
  tenantId: "test",
  userId: null,
  guestEmail: "guest@example.invalid",
  cartHash: "fixture",
  status: "pending",
  expiresAt: "2030-01-01",
  subtotalCents: 1200,
  shippingCents: 0,
  taxCents: 0,
  totalCents: 1200,
  fulfillment: "pickup",
  squareOrderId: "sq",
  squareOrderVersion: 1,
  deviceSessionId: "device",
  shippingAddress: null,
  billingAddress: null,
};
function barrier() {
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, release };
}

function setup() {
  const ready: PaymentAttempt = {
    id: attemptId,
    orderId,
    sequence: 1,
    state: "ready",
    method: "card",
    amountCents: 1200,
    currency: "USD",
    squareIdempotencyKey: key,
    requestDigest: null,
    providerPaymentId: null,
  };
  let current = ready;
  const deps = {
    order,
    attempt: ready,
    ownerBinding: permit.ownerBinding,
    validate: jest.fn(() => Promise.resolve<string | null>(null)),
    readCurrentAttempt: jest.fn(() => Promise.resolve(current)),
    fingerprints: jest.fn(() => ({
      requestDigest: "a".repeat(64),
      sourceDigest: "b".repeat(64),
    })),
    beginDispatch: jest.fn((input: BeginDispatchInput): Promise<DispatchDecision> => {
      if (current.state !== "ready")
        return Promise.resolve({ kind: "observe" as const, attempt: current });
      current = {
        ...current,
        state: "dispatch_started",
        requestDigest: input.requestDigest,
      };
      return Promise.resolve({ kind: "dispatch" as const, attempt: current });
    }),
    createPayment: jest.fn(() =>
      Promise.resolve({
        id: "payment-1",
        referenceId: attemptId,
        orderId: "sq",
        status: "COMPLETED" as const,
        totalCents: 1200,
      }),
    ),
    declineCode: jest.fn(() => null),
    recordAttemptOutcome: jest.fn((input: RecordOutcomeInput) => {
      current = {
        ...current,
        state: input.state,
        providerPaymentId: input.providerPaymentId,
      };
      return Promise.resolve(current);
    }),
    save: jest.fn(() => Promise.resolve()),
    reportError: jest.fn(),
  };
  return {
    deps,
    get current() {
      return current;
    },
  };
}

it("a reloaded observer cannot invoke the gateway between durable claim and first invocation", async () => {
  const f = setup(),
    committed = barrier(),
    allowInvocation = barrier();
  const claim = f.deps.beginDispatch.getMockImplementation()!;
  f.deps.beginDispatch.mockImplementationOnce(async (input) => {
    const decision = await claim(input);
    committed.release();
    await allowInvocation.reached;
    return decision;
  });
  const first = dispatchPayment({ permit, sourceId: "fixture-one" }, f.deps);
  await committed.reached;
  const reloaded = { ...f.deps, attempt: f.current };
  const second = await dispatchPayment(
    { permit: { ...permit }, sourceId: "fixture-two" },
    reloaded,
  );
  expect(second).toMatchObject({ kind: "observe", attemptId });
  expect(f.deps.createPayment).toHaveBeenCalledTimes(0);
  allowInvocation.release();
  expect(await first).toMatchObject({ kind: "observe", attemptId });
  expect(f.deps.createPayment).toHaveBeenCalledTimes(1);
  expect(f.deps.createPayment).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: key, attemptId }),
  );
  expect(f.current.state).toBe("succeeded");
});

it("a committed claim with a lost response remains in inquiry across reload", async () => {
  const f = setup(),
    claim = f.deps.beginDispatch.getMockImplementation()!;
  f.deps.beginDispatch.mockImplementationOnce(async (input) => {
    await claim(input);
    throw Error("response lost");
  });
  expect((await dispatchPayment({ permit, sourceId: "fixture" }, f.deps)).kind).toBe(
    "observe",
  );
  expect(f.current.state).toBe("dispatch_started");
  expect(
    (
      await dispatchPayment(
        { permit, sourceId: "fixture" },
        { ...f.deps, attempt: f.current },
      )
    ).kind,
  ).toBe("observe");
  expect(f.deps.createPayment).toHaveBeenCalledTimes(0);
});

it.each(["", "CASH", "EXTERNAL"])(
  "rejects an invalid source before claiming a ready attempt (%s)",
  async (sourceId) => {
    const f = setup();
    expect(await dispatchPayment({ permit, sourceId }, f.deps)).toMatchObject({
      kind: "not_submitted",
      code: "PAYMENT_NOT_SUBMITTED",
    });
    expect(f.deps.beginDispatch).not.toHaveBeenCalled();
    expect(f.deps.createPayment).not.toHaveBeenCalled();
  },
);

it.each([
  "timeout",
  "source_used",
  "idempotency_conflict",
  "outcome_save_failure",
  "projection_save_failure",
])("observes after %s even if a later input is invalid", async (failure) => {
  const f = setup();
  if (failure === "outcome_save_failure")
    f.deps.recordAttemptOutcome.mockRejectedValueOnce(Error(failure));
  else if (failure === "projection_save_failure")
    f.deps.save.mockRejectedValueOnce(Error(failure));
  else f.deps.createPayment.mockRejectedValueOnce(Error(failure));
  expect((await dispatchPayment({ permit, sourceId: "fixture" }, f.deps)).kind).toBe(
    "observe",
  );
  expect(
    (
      await dispatchPayment(
        { permit, sourceId: "CASH" },
        { ...f.deps, attempt: f.current },
      )
    ).kind,
  ).toBe("observe");
  expect(f.deps.createPayment).toHaveBeenCalledTimes(1);
});

it("observes the newer current sequence after validation and ignores a stale key", async () => {
  const f = setup(),
    newest = {
      ...f.current,
      id: "4585f77a-9001-40d7-bd04-7aea8dc1885f",
      state: "unknown" as const,
      sequence: 2,
    };
  f.deps.readCurrentAttempt.mockResolvedValue(newest);
  expect(await dispatchPayment({ permit, sourceId: "" }, f.deps)).toMatchObject({
    kind: "observe",
    attemptId: newest.id,
  });
  expect(
    (
      await dispatchPayment(
        { permit: { ...permit, squareIdempotencyKey: attemptId }, sourceId: "fixture" },
        f.deps,
      )
    ).kind,
  ).toBe("observe");
  expect(f.deps.beginDispatch).not.toHaveBeenCalled();
});

it("two newly issued guest bearers share the committed call and the persisted key", async () => {
  const f = setup(),
    redis = permitRedisFixture();
  let tokens = 0;
  const store = new PaymentPermitStore(redis, () => `test-permit-${++tokens}`);
  const fixedOrder = {
    guestContextHash: "a".repeat(64),
    ...order,
    deviceSessionId: "eeeeeeee-2222-4222-8222-222222222222",
    pickupContact: { name: "Fixture Buyer", phone: "2025550100" },
    billingAddress: {
      line1: "1 Main",
      line2: null,
      city: "Washington",
      state: "DC",
      postalCode: "20001",
      country: "US" as const,
    },
  };
  const shared = {
    getSession: () => Promise.resolve(null),
    getAccess: () => Promise.resolve({ open: true as const }),
    loadOrder: () => Promise.resolve(fixedOrder),
    now: () => new Date("2026-11-25T00:00:00Z"),
    reportError: jest.fn(),
  };
  const issueDeps = {
    ...shared,
    refusalDisposition: () => Promise.resolve("refuse" as const),
    findTenantId: () => Promise.resolve(order.tenantId),
    verifyBrowser: () =>
      Promise.resolve({ allowed: true as const, reason: "passed" as const }),
    getClientIp: () => "127.0.0.1",
    validateGuestAccess: () => Promise.resolve(true),
    verifyTurnstile: () =>
      Promise.resolve({ allowed: true as const, reason: "passed" as const }),
    checkPaymentAttempt: () =>
      Promise.resolve({ allowed: true, retryAfterSeconds: null }),
    hashEmail: () => "test-hash",
    getOrCreateAttempt: () => Promise.resolve(f.current),
    issuePermit: store.issue.bind(store),
  };
  const request = (body: unknown) =>
    new Request("https://unit.invalid", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never;
  async function issue() {
    const response = await issuePaymentPermitHandler(
      request({
        orderId,
        deviceSessionId: fixedOrder.deviceSessionId,
        method: "card",
        guestAccessToken: "test-grant",
        turnstileToken: "test-verdict",
      }),
      issueDeps,
    );
    expect(response.status).toBe(201);
    return (await response.json()).permit as string;
  }
  const first = await issue(),
    second = await issue();
  expect(first).not.toBe(second);
  const committed = barrier(),
    release = barrier();
  const claim = f.deps.beginDispatch.getMockImplementation()!;
  f.deps.beginDispatch.mockImplementationOnce(async (input) => {
    const result = await claim(input);
    committed.release();
    await release.reached;
    return result;
  });
  const payDeps = {
    canReportNegative: () => Promise.resolve(true),
    getClientIp: () => "203.0.113.3",
    acquireGateway: () =>
      Promise.resolve({ allowed: true as const, release: () => Promise.resolve() }),
    ...f.deps,
    ...shared,
    consumePermit: store.consume.bind(store),
    validateShippingAddress: jest.fn(),
    recordDecline: jest.fn(),
    enqueueLegacyInquiry: jest.fn(),
    savePaymentId: jest.fn(),
  };
  const winning = createDirectPaymentHandler(
    request({ permit: first, sourceId: "inert-input-one" }),
    payDeps,
  );
  await committed.reached;
  const following = await createDirectPaymentHandler(
    request({ permit: second, sourceId: "inert-input-two" }),
    { ...payDeps },
  );
  expect(await following.json()).toMatchObject({ status: "UNKNOWN", attemptId });
  expect(f.deps.createPayment).toHaveBeenCalledTimes(0);
  release.release();
  expect(await (await winning).json()).toMatchObject({
    status: "COMPLETED",
    paymentId: "payment-1",
    attemptId,
  });
  expect(f.deps.createPayment).toHaveBeenCalledTimes(1);
  expect(f.deps.createPayment).toHaveBeenCalledWith(
    expect.objectContaining({ attemptId, idempotencyKey: key }),
  );
});

it("proves a pre-claim configuration failure against the latest ready row", async () => {
  const f = setup();
  f.deps.fingerprints.mockImplementationOnce(() => {
    throw new Error("configuration unavailable");
  });
  expect(await dispatchPayment({ permit, sourceId: "fixture" }, f.deps)).toMatchObject({
    kind: "not_submitted",
    code: "PAYMENT_NOT_SUBMITTED",
  });
  expect(f.deps.beginDispatch).not.toHaveBeenCalled();
});
it("rechecks the order sequence after a rejected payable check", async () => {
  const f = setup();
  f.deps.beginDispatch.mockRejectedValueOnce({
    code: "P0001",
    message: "checkout_order_not_payable",
  });
  expect((await dispatchPayment({ permit, sourceId: "fixture" }, f.deps)).kind).toBe(
    "not_submitted",
  );
  expect(f.deps.createPayment).not.toHaveBeenCalled();
});

it.each([
  ["declined", null, "declined"],
  ["declined", "legacy-decline", "declined"],
  ["canceled", "legacy-cancel", "declined"],
  ["canceled", null, "observe"],
] as const)(
  "resolves %s with provider identity %s without a fresh dispatch",
  async (state, providerPaymentId, kind) => {
    const f = setup(),
      attempt = {
        ...f.current,
        state,
        providerPaymentId,
        requestDigest:
          state === "declined" && providerPaymentId === null ? "d".repeat(64) : null,
      };
    const result = await dispatchPayment(
      { permit, sourceId: "" },
      { ...f.deps, attempt },
    );
    expect(result).toMatchObject({ kind, attemptId });
    expect(f.deps.beginDispatch).not.toHaveBeenCalled();
    expect(f.deps.recordAttemptOutcome).not.toHaveBeenCalled();
  },
);

it.each(["COMPLETED", "FAILED", "CANCELED"])(
  "keeps out-of-location %s in inquiry after a committed claim",
  async (status) => {
    const f = setup();
    const create = jest.fn().mockResolvedValue({
      payment: {
        id: "fixture-wrong-location",
        orderId: order.squareOrderId,
        referenceId: attemptId,
        locationId: "wrong",
        status,
        sourceType: "CARD",
        amountMoney: { amount: BigInt(1200), currency: "USD" },
      },
    });
    const gateway = new SquarePaymentsGateway({ create, get: jest.fn() }, "expected");
    const deps = {
      ...f.deps,
      createPayment: (input: DirectPaymentInput) => gateway.create(input),
    };
    expect((await dispatchPayment({ permit, sourceId: "fixture" }, deps)).kind).toBe(
      "observe",
    );
    expect(f.current).toMatchObject({ state: "unknown", providerPaymentId: null });
    expect(
      (
        await dispatchPayment(
          { permit, sourceId: "fixture" },
          { ...deps, attempt: f.current },
        )
      ).kind,
    ).toBe("observe");
    expect(create).toHaveBeenCalledTimes(1);
    expect(f.deps.save).not.toHaveBeenCalled();
  },
);

it.each([
  ["checkout_gateway_limited", "quota"],
  ["checkout_dispatch_paused", "paused"],
])(
  "emits authoritative %s separately from preflight and SDK calls",
  async (message, reason) => {
    const f = setup(),
      lines: string[] = [];
    const record = (line: string) => {
      lines.push(line);
    };
    const sinks = [
      jest.spyOn(console, "info").mockImplementation(record),
      jest.spyOn(console, "warn").mockImplementation(record),
    ];
    const repo = new CheckoutPaymentAttemptRepository({
      rpc: jest.fn().mockResolvedValue({ data: null, error: { code: "P0001", message } }),
    } as never);
    try {
      const result = await dispatchPayment(
        { permit, sourceId: "local" },
        { ...f.deps, beginDispatch: (i) => repo.beginDispatch(i) },
      );
      expect(result.kind).toBe("not_submitted");
      expect(f.deps.createPayment).not.toHaveBeenCalled();
      const metrics = summarizeCheckoutEvents(lines.map((line) => JSON.parse(line)));
      expect(metrics.admission["authority.gateway_attempt.denied." + reason]).toBe(1);
      expect(metrics.gateway.calls).toBe(0);
    } finally {
      for (const sink of sinks) sink.mockRestore();
    }
  },
);
