import type { ConsumedPaymentPermit } from "../ContractCompatibility/payment-permit-reader";
import type { CheckoutPaymentAttemptRepository } from "./attempt-repository";
import type { PaymentAttempt, VerifiedAttemptFacts } from "./attempt-contract";
import type { DirectPaymentInput, DirectPaymentResult } from "@/lib/square/payments";
import type { PaymentCheckout } from "@/repositories/checkout-reservation-repo";

type DispatchResult =
  | { kind: "observe"; orderId: string; attemptId: string; statusUrl: string }
  | { kind: "not_submitted"; code: "PAYMENT_NOT_SUBMITTED"; message: string }
  | { kind: "declined"; orderId: string; attemptId: string };

export type DispatchOperations = Pick<
  CheckoutPaymentAttemptRepository,
  "beginDispatch" | "recordAttemptOutcome"
> & {
  readCurrentAttempt(orderId: string): Promise<PaymentAttempt | null>;
  fingerprints(input: DirectPaymentInput): {
    sourceDigest: string;
    requestDigest: string;
  };
  createPayment(input: DirectPaymentInput): Promise<DirectPaymentResult>;
  declineCode(
    error: unknown,
  ): Extract<VerifiedAttemptFacts, { kind: "square_decline" }>["code"] | null;
};

type Dependencies = DispatchOperations & {
  order: PaymentCheckout;
  attempt: PaymentAttempt;
  ownerBinding: string;
  onAttemptObserved?(attempt: PaymentAttempt): void;
  validate(): Promise<string | null>;
  save(payment: DirectPaymentResult): Promise<void>;
  reportError(error: Error): void;
};

function resolveObserved(attempt: PaymentAttempt, deps: Dependencies): DispatchResult {
  deps.onAttemptObserved?.(attempt);
  if (
    attempt.state === "declined" ||
    (attempt.state === "canceled" && attempt.providerPaymentId !== null)
  )
    return { kind: "declined", orderId: attempt.orderId, attemptId: attempt.id };
  return {
    kind: "observe",
    orderId: attempt.orderId,
    attemptId: attempt.id,
    statusUrl: `/checkout/processing?orderId=${encodeURIComponent(attempt.orderId)}`,
  };
}

export async function dispatchPayment(
  request: { permit: ConsumedPaymentPermit; sourceId: string },
  deps: Dependencies,
): Promise<DispatchResult> {
  try {
    return await dispatch(request, deps);
  } catch {
    // A lost commit or provider response leaves recovery responsible for inquiry.
    deps.reportError(new Error("checkout_payment_outcome_unavailable"));
    return resolveObserved(deps.attempt, deps);
  }
}

async function beforeSubmission(
  deps: Dependencies,
  message: string,
): Promise<DispatchResult> {
  const latest = await deps.readCurrentAttempt(deps.order.orderId);
  if (!latest) throw new Error("Checkout attempt unavailable");
  if (latest.id !== deps.attempt.id || latest.state !== "ready")
    return resolveObserved(latest, deps);
  return { kind: "not_submitted", code: "PAYMENT_NOT_SUBMITTED", message };
}

async function dispatch(
  { permit, sourceId }: { permit: ConsumedPaymentPermit; sourceId: string },
  deps: Dependencies,
): Promise<DispatchResult> {
  const { order, attempt, ownerBinding } = deps;
  if (attempt.orderId !== order.orderId || permit.orderId !== order.orderId)
    throw new Error("Invalid checkout attempt binding");
  if (
    ("attemptId" in permit &&
      (permit.attemptId !== attempt.id || permit.ownerBinding !== ownerBinding)) ||
    permit.squareIdempotencyKey !== attempt.squareIdempotencyKey ||
    attempt.method !== permit.method ||
    attempt.amountCents !== permit.totalCents ||
    attempt.state !== "ready"
  )
    return resolveObserved(attempt, deps);

  sourceId = sourceId.trim();
  const message =
    !sourceId ||
    sourceId.length > 2048 ||
    ["CASH", "EXTERNAL"].includes(sourceId.toUpperCase())
      ? "Payment source is invalid. Please try again."
      : await deps
          .validate()
          .catch(() => "Checkout verification is temporarily unavailable. Please retry.");
  if (message) return beforeSubmission(deps, message);
  const input: DirectPaymentInput = {
    localOrderId: order.orderId,
    attemptId: attempt.id,
    method: attempt.method,
    squareOrderId: order.squareOrderId!,
    sourceId,
    idempotencyKey: attempt.squareIdempotencyKey,
    totalCents: attempt.amountCents,
    billingAddress: order.billingAddress,
    shippingAddress: order.shippingAddress,
  };
  let digests: ReturnType<DispatchOperations["fingerprints"]>;
  try {
    digests = deps.fingerprints(input);
  } catch {
    return beforeSubmission(deps, "Payment is temporarily unavailable. Please retry.");
  }
  let decision: Awaited<ReturnType<DispatchOperations["beginDispatch"]>>;
  try {
    decision = await deps.beginDispatch({
      attemptId: attempt.id,
      ownerBinding,
      ...digests,
    });
  } catch (error) {
    // Only this explicit, rolled-back SQL eligibility decision proves the call did not win.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P0001" &&
      "message" in error &&
      error.message === "checkout_order_not_payable"
    )
      return beforeSubmission(
        deps,
        "Checkout is no longer payable. Return to checkout and review it.",
      );
    throw error;
  }
  if (decision.kind === "observe")
    return resolveObserved(
      (await deps.readCurrentAttempt(order.orderId)) ?? attempt,
      deps,
    );
  if (
    decision.attempt.orderId !== order.orderId ||
    decision.attempt.id !== attempt.id ||
    decision.attempt.method !== input.method ||
    decision.attempt.amountCents !== input.totalCents ||
    decision.attempt.squareIdempotencyKey !== input.idempotencyKey
  )
    throw new Error("Invalid committed payment binding");

  // The claim and recovery enqueue have committed. Only this winner can call the provider.
  let payment: DirectPaymentResult;
  try {
    payment = await deps.createPayment(input);
  } catch (error) {
    const code = deps.declineCode(error);
    if (code) {
      const recorded = await deps.recordAttemptOutcome({
        attemptId: attempt.id,
        providerPaymentId: null,
        state: "declined",
        verifiedFacts: {
          kind: "square_decline",
          code,
          requestDigest: digests.requestDigest,
        },
      });
      return resolveObserved(recorded, deps);
    }
    const retained = await deps.recordAttemptOutcome({
      attemptId: attempt.id,
      providerPaymentId: null,
      state: "unknown",
      verifiedFacts: { kind: "uncertain", reason: "outcome_unavailable" },
    });
    return resolveObserved(retained, deps);
  }
  const state = {
    COMPLETED: "succeeded",
    PENDING: "pending",
    APPROVED: "pending",
    FAILED: "declined",
    CANCELED: "canceled",
  } as const;
  const recorded = await deps.recordAttemptOutcome({
    attemptId: attempt.id,
    providerPaymentId: payment.id,
    state: state[payment.status],
    verifiedFacts: {
      kind: "square_payment",
      orderId: order.orderId,
      squareOrderId: payment.orderId,
      paymentId: payment.id,
      status: payment.status,
      amountCents: payment.totalCents,
      currency: "USD",
    },
  });
  if (payment.status !== "FAILED" && payment.status !== "CANCELED")
    await deps.save(payment);
  return resolveObserved(recorded, deps);
}
