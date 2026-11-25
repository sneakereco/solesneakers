import { z } from "zod";
import type { PaymentMethod } from "@/lib/checkout/payment-permit";

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,192}$/);
const method = z.enum([
  "card",
  "afterpay",
  "applePay",
  "cashAppPay",
] satisfies PaymentMethod[]);
const state = z.enum([
  "ready",
  "dispatch_started",
  "pending",
  "unknown",
  "succeeded",
  "declined",
  "canceled",
  "review",
]);
export type AttemptState = z.infer<typeof state>;

export const paymentAttemptSchema = z
  .object({
    id: z.uuid(),
    orderId: z.uuid(),
    sequence: z.number().int().positive(),
    state,
    method,
    amountCents: z.number().int().positive().max(2147483647),
    currency: z.literal("USD"),
    squareIdempotencyKey: z.uuid(),
    requestDigest: digest.nullable(),
    providerPaymentId: providerId.nullable(),
  })
  .strict()
  .refine(
    (a) =>
      a.state !== "ready" || (a.requestDigest === null && a.providerPaymentId === null),
  )
  .refine(
    (a) =>
      !["dispatch_started", "unknown", "pending", "succeeded", "declined"].includes(
        a.state,
      ) || a.requestDigest !== null,
  );
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

// A scope identifier is constructed only after server verification of the account,
// original signed guest context, or an order-specific guest access grant.
const ownerBinding = z.string().refine((binding) => {
  const [kind, value, ...rest] = binding.split(":");
  if (rest.length || !value) return false;
  if (kind === "guest") return digest.safeParse(value).success;
  return (kind === "account" || kind === "order") && z.uuid().safeParse(value).success;
});
export const getAttemptSchema = z
  .object({ orderId: z.uuid(), method, ownerBinding })
  .strict();
export const beginDispatchSchema = z
  .object({
    attemptId: z.uuid(),
    ownerBinding,
    requestDigest: digest,
    sourceDigest: digest,
  })
  .strict();
export const dispatchDecisionSchema = z
  .object({
    kind: z.enum(["dispatch", "observe"]),
    attempt: paymentAttemptSchema,
  })
  .strict()
  .refine((d) =>
    d.kind === "dispatch"
      ? d.attempt.state === "dispatch_started" && d.attempt.providerPaymentId === null
      : d.attempt.state !== "ready",
  );

const verifiedFactsSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("square_payment"),
      orderId: z.uuid(),
      squareOrderId: providerId,
      paymentId: providerId,
      amountCents: z.number().int().positive().max(2147483647),
      currency: z.literal("USD"),
      status: z.enum(["PENDING", "APPROVED", "COMPLETED", "CANCELED", "FAILED"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("square_decline"),
      requestDigest: digest,
      code: z.enum([
        "ADDRESS_VERIFICATION_FAILURE",
        "BUYER_REFUSED_PAYMENT",
        "CARD_DECLINED",
        "CARD_DECLINED_CALL_ISSUER",
        "CARD_DECLINED_VERIFICATION_REQUIRED",
        "CARD_EXPIRED",
        "CVV_FAILURE",
        "GENERIC_DECLINE",
        "INSUFFICIENT_FUNDS",
        "INVALID_ACCOUNT",
        "INVALID_CARD",
        "INVALID_CARD_DATA",
        "INVALID_EXPIRATION",
        "INVALID_EXPIRATION_DATE",
        "INVALID_EXPIRATION_YEAR",
        "INVALID_POSTAL_CODE",
        "TRANSACTION_LIMIT",
        "VERIFY_AVS_FAILURE",
        "VERIFY_CVV_FAILURE",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("uncertain"),
      reason: z.enum([
        "response_lost",
        "provider_timeout",
        "invalid_provider_response",
        "idempotency_conflict",
        "source_reused",
        "outcome_unavailable",
        "inquiry_inconclusive",
        "provider_conflict",
      ]),
    })
    .strict(),
]);
export const recordOutcomeSchema = z
  .object({
    attemptId: z.uuid(),
    providerPaymentId: providerId.nullable(),
    state: z.enum(["pending", "unknown", "succeeded", "declined", "canceled", "review"]),
    verifiedFacts: verifiedFactsSchema,
  })
  .strict();
export type VerifiedAttemptFacts = z.infer<typeof verifiedFactsSchema>;
export type GetAttemptInput = z.infer<typeof getAttemptSchema>;
export type BeginDispatchInput = z.infer<typeof beginDispatchSchema>;
export type RecordOutcomeInput = z.infer<typeof recordOutcomeSchema>;
export type DispatchDecision = z.infer<typeof dispatchDecisionSchema>;
