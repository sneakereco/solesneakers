const afterCallbacks: Array<() => Promise<void>> = [];
const orderId = "00989365-3f2f-4248-9f6e-f850482fbf46";
const attemptId = "01fff41a-5789-4017-8a94-349c342a36b1";
const leaseToken = "0f7508a3-0b0a-455f-8bd7-9cc30e297602";
let capacityAvailable = true;
let outcomeWriteFails = false;
const rpcCalls: string[] = [];
const admin = {
  rpc: (name: string, args: Record<string, unknown>) => {
    rpcCalls.push(name);
    if (name === "record_checkout_payment_outcome") {
      if (outcomeWriteFails)
        return Promise.resolve({ data: null, error: Error("outcome write unavailable") });
      return Promise.resolve({
        data: {
          id: attemptId,
          orderId,
          sequence: 1,
          state: args.p_state,
          method: "cashAppPay",
          amountCents: 112280,
          currency: "USD",
          squareIdempotencyKey: "2cab719a-cd6f-47ea-89cf-0893751e41e8",
          requestDigest: "a".repeat(64),
          providerPaymentId: args.p_provider_payment_id ?? null,
        },
        error: null,
      });
    }
    if (name === "acquire_checkout_dependency_lease")
      return Promise.resolve({
        data: capacityAvailable ? leaseToken : null,
        error: null,
      });
    if (name === "release_checkout_dependency_lease")
      return Promise.resolve({ data: null, error: null });
    return Promise.reject(Error("Unexpected RPC: " + name));
  },
};

jest.mock("next/server", () => ({
  after: jest.fn((callback: () => Promise<void>) => afterCallbacks.push(callback)),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: () => admin,
}));
jest.mock("@/lib/square/client", () => ({
  createSquareClient: () => ({}),
  createSquarePaymentsGateway: jest.fn(),
}));
jest.mock("@/lib/square/config", () => ({
  getSquareConfig: () => ({ locationId: "location" }),
  getSquareMerchantId: () => "merchant",
}));
jest.mock("@/Modules/Analytics/Source/Features/EventDelivery/delivery-runtime", () => ({
  scheduleAnalyticsDrain: jest.fn(),
}));
jest.mock("@/lib/utils/log", () => ({ log: jest.fn(), logError: jest.fn() }));

import { after } from "next/server";
import { SquareFinancialInquiry } from "@/Modules/Checkout/Source/Features/Payments/square-financial-inquiry";
import { createDirectPaymentDependencies } from "@/lib/checkout/payment-api-dependencies";
import { logError } from "@/lib/utils/log";

beforeEach(() => {
  afterCallbacks.length = 0;
  rpcCalls.length = 0;
  capacityAvailable = true;
  outcomeWriteFails = false;
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());

it.each(["succeeded", "pending", "unknown"] as const)(
  "promptly reconciles a committed %s payment without waiting for a webhook or cron",
  async (state) => {
    const recover = jest
      .spyOn(SquareFinancialInquiry.prototype, "recoverAttempt")
      .mockResolvedValue("done");
    const deps = createDirectPaymentDependencies("request");
    const attempt = await deps.recordAttemptOutcome({
      attemptId,
      state,
      providerPaymentId: state === "unknown" ? null : "payment",
      verifiedFacts:
        state === "unknown"
          ? { kind: "uncertain", reason: "outcome_unavailable" }
          : {
              kind: "square_payment",
              orderId,
              squareOrderId: "square-order",
              paymentId: "payment",
              status: state === "succeeded" ? "COMPLETED" : "PENDING",
              amountCents: 112280,
              currency: "USD",
            },
    });

    expect(attempt.state).toBe(state);
    expect(recover).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(recover).toHaveBeenCalledWith(orderId, attemptId);
    expect(rpcCalls).toEqual([
      "record_checkout_payment_outcome",
      "acquire_checkout_dependency_lease",
      "release_checkout_dependency_lease",
    ]);
  },
);

async function recordAcceptedPayment() {
  return createDirectPaymentDependencies("request").recordAttemptOutcome({
    attemptId,
    providerPaymentId: "payment",
    state: "succeeded",
    verifiedFacts: {
      kind: "square_payment",
      orderId,
      squareOrderId: "square-order",
      paymentId: "payment",
      status: "COMPLETED",
      amountCents: 112280,
      currency: "USD",
    },
  });
}

it("does not start inquiry when recording the payment outcome failed", async () => {
  outcomeWriteFails = true;
  await expect(recordAcceptedPayment()).rejects.toThrow("outcome write unavailable");
  expect(afterCallbacks).toHaveLength(0);
});

it("does not prompt a definitively declined payment", async () => {
  await createDirectPaymentDependencies("request").recordAttemptOutcome({
    attemptId,
    providerPaymentId: null,
    state: "declined",
    verifiedFacts: {
      kind: "square_decline",
      code: "CARD_DECLINED",
      requestDigest: "a".repeat(64),
    },
  });
  expect(afterCallbacks).toHaveLength(0);
});

it("leaves the committed payment recoverable when background scheduling is unavailable", async () => {
  jest.mocked(after).mockImplementationOnce(() => {
    throw Error("request finished");
  });
  await expect(recordAcceptedPayment()).resolves.toMatchObject({ state: "succeeded" });
  expect(logError).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({ event: "square_payment_reconciliation_failed" }),
  );
});

it("does not exceed recovery capacity or submit another payment when all slots are busy", async () => {
  const recover = jest.spyOn(SquareFinancialInquiry.prototype, "recoverAttempt");
  capacityAvailable = false;
  await recordAcceptedPayment();
  expect(afterCallbacks).toHaveLength(1);
  await afterCallbacks[0]();
  expect(recover).not.toHaveBeenCalled();
  expect(rpcCalls).toEqual([
    "record_checkout_payment_outcome",
    "acquire_checkout_dependency_lease",
  ]);
});

it("keeps the accepted payment intact and reports a failed prompt for durable recovery", async () => {
  jest
    .spyOn(SquareFinancialInquiry.prototype, "recoverAttempt")
    .mockRejectedValue(Error("provider unavailable"));
  await recordAcceptedPayment();
  expect(afterCallbacks).toHaveLength(1);
  await expect(afterCallbacks[0]()).resolves.toBeUndefined();
  expect(rpcCalls.at(-1)).toBe("release_checkout_dependency_lease");
  expect(logError).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({
      event: "square_payment_reconciliation_failed",
      orderId,
      attemptId,
    }),
  );
});
