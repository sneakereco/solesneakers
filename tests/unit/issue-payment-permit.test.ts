import { readOrderFinancialEvidence } from "@/Modules/Orders/Source/Features/OrderStatus/financial-evidence";
import { createIssuePaymentPermitDependencies } from "@/lib/checkout/payment-api-dependencies";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";

jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));
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
    refusalDisposition:
      createIssuePaymentPermitDependencies("unit-permit").refusalDisposition,
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
    getOrCreateAttempt: jest.fn().mockResolvedValue({
      id: DEVICE_ID,
      orderId: ORDER_ID,
      method: "afterpay",
      state: "ready",
      amountCents: 11800,
      squareIdempotencyKey: DEVICE_ID,
    }),
    issuePermit: jest
      .fn()
      .mockResolvedValue({ token: "permit-1", expiresInSeconds: 120 }),
    reportError: jest.fn(),
    now: jest.fn(() => new Date("2026-09-06T12:00:00.000Z")),
  };
}

describe("issuePaymentPermitHandler", () => {
  it("directs the authorized shopper to status when money is independently under review", async () => {
    const deps = dependencies();
    deps.getAccess.mockResolvedValue({ open: false, message: "Dispatch paused" });
    const original = await deps.loadOrder();
    deps.loadOrder.mockResolvedValue({
      ...original,
      financialReview: "square_terminal_capture_conflict",
    });
    const response = await issuePaymentPermitHandler(
      request({
        orderId: ORDER_ID,
        guestAccessToken: "guest-token",
        deviceSessionId: DEVICE_ID,
        method: "card",
        turnstileToken: "proof",
      }),
      deps,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CHECKOUT_RECOVERY_REQUIRED",
      orderId: ORDER_ID,
    });
    expect(deps.getOrCreateAttempt).not.toHaveBeenCalled();
    expect(deps.issuePermit).not.toHaveBeenCalled();
  });
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
    expect(deps.getOrCreateAttempt).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      method: "afterpay",
      ownerBinding: "order:" + ORDER_ID,
    });
    expect(deps.issuePermit).toHaveBeenCalledWith({
      attemptId: DEVICE_ID,
      ownerBinding: "order:" + ORDER_ID,
      tenantId: "tenant-1",
      orderId: ORDER_ID,
      cartHash: "cart-hash",
      totalCents: 11800,
      method: "afterpay",
      deviceSessionId: DEVICE_ID,
      normalizedEmailHash: "email-hash",
      squareIdempotencyKey: DEVICE_ID,
    });
  });
});

it("derives the account scope from the verified session and denies a failed guest grant before issuance", async () => {
  const deps = dependencies(),
    body = {
      orderId: ORDER_ID,
      deviceSessionId: DEVICE_ID,
      method: "afterpay",
      guestAccessToken: "token",
      turnstileToken: "test",
    };
  deps.validateGuestAccess.mockResolvedValue(false);
  expect((await issuePaymentPermitHandler(request(body), deps)).status).toBe(403);
  expect(deps.getOrCreateAttempt).not.toHaveBeenCalled();
  const order = await deps.loadOrder();
  deps.loadOrder.mockResolvedValue({ ...order, userId: DEVICE_ID, guestEmail: null });
  deps.getSession.mockResolvedValue({
    user: { id: DEVICE_ID, email: "account@example.invalid" },
  });
  expect((await issuePaymentPermitHandler(request(body), deps)).status).toBe(201);
  expect(deps.getOrCreateAttempt).toHaveBeenCalledWith({
    orderId: ORDER_ID,
    method: "afterpay",
    ownerBinding: "account:" + DEVICE_ID,
  });
});

describe("authorized permit admission refusals", () => {
  const guestContext = "trusted-guest-context";
  const body = {
    orderId: ORDER_ID,
    guestAccessToken: "grant",
    deviceSessionId: DEVICE_ID,
    method: "card",
    turnstileToken: "proof",
  };
  function evidence(kind: "unpaid" | "paid" | "review") {
    const paid = kind === "paid";
    const reviewed = kind === "review";
    const originalAttempt = {
      id: DEVICE_ID,
      order_id: ORDER_ID,
      sequence: 1,
      state: reviewed ? "declined" : "succeeded",
      currency: "USD",
      amount_cents: 11800,
      square_order_id: "square-order-1",
      provider_payment_id: "payment-1" as string | null,
      terminal_capture: reviewed
        ? {
            kind: "payment",
            providerId: "payment-1",
            paymentId: "payment-1",
            orderId: ORDER_ID,
            providerVersion: "v1",
            status: "COMPLETED",
            amountCents: 11800,
            currency: "USD",
            expectedTotalCents: 11800,
            fulfillmentStatus: "unfulfilled",
            observedAt: "2026-09-06T12:00:00Z",
          }
        : null,
    };
    const attempts = paid || reviewed ? [originalAttempt] : [];
    if (reviewed)
      attempts.push({
        ...originalAttempt,
        id: "33333333-3333-4333-8333-333333333333",
        sequence: 2,
        state: "ready",
        provider_payment_id: null,
        terminal_capture: null,
      });
    const facts = paid
      ? [
          {
            order_id: ORDER_ID,
            kind: "payment",
            provider_id: "payment-1",
            payment_id: "payment-1",
            provider_version: "v1",
            amount_cents: 11800,
            currency: "USD",
            status: "COMPLETED",
          },
        ]
      : [];
    return {
      id: ORDER_ID,
      tenant_id: "tenant-1",
      user_id: null as string | null,
      checkout_guest_context_hash: guestContext as string | null,
      checkout_attempt_guarded: true,
      total: 118,
      currency: "USD",
      status: paid ? "paid" : "pending",
      fulfillment_status: null,
      refund_amount: null,
      payment_transaction_id: paid || reviewed ? "payment-1" : null,
      square_order_id: "square-order-1",
      checkout_financial_review:
        kind === "review" ? "square_terminal_capture_conflict" : null,
      facts,
      attempts,
      refunds: [],
      factCount: [{ count: facts.length }],
      attemptCount: [{ count: attempts.length }],
      refundCount: [{ count: 0 }],
    };
  }
  async function fixture(isAccount = false) {
    const owner = isAccount ? DEVICE_ID : null;
    const context = isAccount ? null : guestContext;
    const bind = (kind: Parameters<typeof evidence>[0]) => ({
      ...evidence(kind),
      user_id: owner,
      checkout_guest_context_hash: context,
    });
    let row = bind("unpaid");
    const read = jest.fn(() => Promise.resolve({ data: row, error: null }));
    const eq = jest.fn(() => ({ maybeSingle: read }));
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ select }));
    jest.mocked(createSupabaseAdminClient).mockReturnValue({ from } as never);
    const deps = dependencies();
    const order = {
      ...(await deps.loadOrder()),
      userId: owner,
      guestContextHash: context,
    };
    deps.loadOrder.mockResolvedValue(order);
    if (isAccount)
      deps.getSession.mockResolvedValue({
        user: { id: owner, email: "buyer@example.com" },
      });
    const issue = () => issuePaymentPermitHandler(request(body), deps);
    function noIssuance() {
      expect(deps.getOrCreateAttempt).not.toHaveBeenCalled();
      expect(deps.issuePermit).not.toHaveBeenCalled();
    }
    function checkedOrder() {
      expect(from).toHaveBeenCalledWith("orders");
      expect(eq).toHaveBeenCalledWith("id", ORDER_ID);
      expect(select).toHaveBeenCalledWith(
        expect.stringContaining("attemptCount:checkout_payment_attempts(count)"),
      );
      expect(read).toHaveBeenCalledTimes(1);
      noIssuance();
    }
    return {
      deps,
      issue,
      bind,
      read,
      noIssuance,
      checkedOrder,
      order,
      commit: (next: typeof row) => {
        row = next;
      },
    };
  }
  async function expectHandoff(response: Response) {
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CHECKOUT_RECOVERY_REQUIRED",
      orderId: ORDER_ID,
      statusUrl: "/checkout/processing?orderId=" + ORDER_ID,
    });
    expect(response.headers.get("Retry-After")).toBeNull();
  }
  it.each(["paid", "review"] as const)(
    "corroborates the %s fixture with the status ledger projection",
    async (kind) => {
      const f = await fixture();
      const row = f.bind(kind);
      f.commit(row);
      const result = await readOrderFinancialEvidence(
        {
          ...row,
          subtotal: 118,
          shipping: 0,
          tax_amount: 0,
          fulfillment: "pickup",
          pickup_instructions: null,
          created_at: "2026-09-06T12:00:00Z",
          updated_at: "2026-09-06T12:00:00Z",
        },
        createSupabaseAdminClient(),
      );
      expect(result.financial).toMatchObject({
        source: "ledger",
        snapshot: {
          financialState: "paid",
          capturedCents: 11800,
          reviewReason: kind === "review" ? "square_terminal_capture_conflict" : null,
        },
      });
    },
  );
  it("hands off a normally paid order without a review marker during pause", async () => {
    const f = await fixture(true);
    f.commit(f.bind("paid"));
    f.deps.loadOrder.mockResolvedValue({ ...f.order, status: "paid" });
    f.deps.getAccess.mockResolvedValue({ open: false, message: "Dispatch paused" });
    await expectHandoff(await f.issue());
    f.checkedOrder();
  });
  it.each(["paid", "review"] as const)(
    "observes %s committed during the awaited access decision",
    async (kind) => {
      const f = await fixture();
      f.deps.getAccess.mockImplementation(async () => {
        await Promise.resolve();
        expect(f.read).not.toHaveBeenCalled();
        f.commit(f.bind(kind));
        return { open: false, message: "Dispatch paused" };
      });
      await expectHandoff(await f.issue());
      f.checkedOrder();
    },
  );
  it.each(["paid", "review"] as const)(
    "observes %s committed during the awaited quota decision",
    async (kind) => {
      const f = await fixture();
      f.deps.checkPaymentAttempt.mockImplementation(async () => {
        await Promise.resolve();
        f.commit(f.bind(kind));
        return { allowed: false, retryAfterSeconds: 37 };
      });
      await expectHandoff(await f.issue());
      f.checkedOrder();
    },
  );
  it.each(["pause", "quota"])(
    "retains the %s decision for a verified unpaid order",
    async (mode) => {
      const f = await fixture();
      if (mode === "pause")
        f.deps.getAccess.mockResolvedValue({ open: false, message: "Dispatch paused" });
      else
        f.deps.checkPaymentAttempt.mockResolvedValue({
          allowed: false,
          retryAfterSeconds: 37,
        });
      const response = await f.issue();
      expect(response.status).toBe(mode === "pause" ? 503 : 429);
      expect(response.headers.get("Retry-After")).toBe(mode === "pause" ? null : "37");
      expect(await response.json()).toMatchObject({
        error:
          mode === "pause"
            ? "Dispatch paused"
            : "Too many payment attempts; please try again later",
      });
      f.checkedOrder();
    },
  );
  it.each([
    "truncated",
    "unavailable",
    "quota unavailable",
    "unresolved attempt",
    "contradictory paid status",
  ])("observes the original order when evidence or admission is %s", async (kind) => {
    const f = await fixture();
    const row = f.bind("unpaid");
    f.deps.checkPaymentAttempt.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 37,
    });
    if (kind === "truncated") row.factCount[0].count = 1;
    if (kind === "unavailable") f.read.mockRejectedValueOnce(Error("unavailable"));
    if (kind === "quota unavailable") {
      f.deps.checkPaymentAttempt.mockRejectedValueOnce(Error("unavailable"));
      f.commit(f.bind("paid"));
    } else {
      if (kind === "unresolved attempt") {
        row.attempts = [{ ...f.bind("paid").attempts[0], state: "unknown" }];
        row.attemptCount = [{ count: 1 }];
      }
      if (kind === "contradictory paid status") row.status = "paid";
      f.commit(row);
    }
    await expectHandoff(await f.issue());
    f.checkedOrder();
  });
  it.each(["account", "device", "guest grant"])(
    "denies a mismatched %s before reading private financial evidence",
    async (kind) => {
      const f = await fixture(kind === "account");
      f.commit(f.bind("paid"));
      f.deps.getAccess.mockResolvedValue({ open: false, message: "Dispatch paused" });
      if (kind === "account") f.deps.getSession.mockResolvedValue(null);
      if (kind === "device")
        f.deps.loadOrder.mockResolvedValue({ ...f.order, deviceSessionId: ORDER_ID });
      if (kind === "guest grant") f.deps.validateGuestAccess.mockResolvedValue(false);
      const response = await f.issue();
      expect(response.status).toBe(403);
      expect(await response.json()).not.toHaveProperty("statusUrl");
      expect(f.read).not.toHaveBeenCalled();
      f.noIssuance();
    },
  );
  it("denies a changed guest context on the bound reread", async () => {
    const f = await fixture();
    f.commit({ ...f.bind("paid"), checkout_guest_context_hash: "other-context" });
    f.deps.getAccess.mockResolvedValue({ open: false, message: "Dispatch paused" });
    const response = await f.issue();
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("statusUrl");
    f.checkedOrder();
  });
});
