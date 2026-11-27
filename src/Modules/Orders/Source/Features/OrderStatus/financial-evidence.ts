import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import type { Tables } from "@/types/db/database.types";
import type { ReceiptFinancialEvidence } from "@/types/domain/checkout";
import {
  financialFact,
  financialSnapshot,
} from "@/Modules/Checkout/Source/Features/Payments/payment-facts";

const money = z.number().int().positive().max(2147483647);
const providerId = financialFact.shape.providerId;
const attempt = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  order_id: z.uuid(),
  provider_payment_id: providerId.nullable(),
  square_order_id: providerId.nullable(),
  amount_cents: money,
  currency: z.literal("USD"),
  state: z.enum([
    "ready",
    "dispatch_started",
    "pending",
    "unknown",
    "succeeded",
    "declined",
    "canceled",
    "review",
  ]),
});
const fact = z.object({
  order_id: z.uuid(),
  kind: financialFact.shape.kind,
  provider_id: providerId,
  provider_version: financialFact.shape.providerVersion,
  payment_id: providerId,
  amount_cents: money,
  currency: z.literal("USD"),
  status: financialFact.shape.status,
});
const refund = z.object({
  order_id: z.uuid(),
  tenant_id: z.string().min(1),
  square_refund_id: providerId,
  square_payment_id: providerId,
  status: z.enum(["PENDING", "COMPLETED", "FAILED", "REJECTED"]),
  amount_cents: money,
  currency: z.literal("USD"),
  checkout_status_conflict: z.boolean(),
});
const count = z.tuple([z.object({ count: z.number().int().nonnegative() })]);
const evidence = z.object({
  facts: z.array(fact).max(1000),
  factCount: count,
  attempts: z.array(attempt).max(1000),
  attemptCount: count,
  refunds: z.array(refund).max(1000),
  refundCount: count,
  checkout_attempt_guarded: z.boolean(),
  checkout_financial_review: z.string().min(1).nullable(),
  refund_amount: z.number().int().nonnegative().nullable(),
  fulfillment_status: z.string().min(1).nullable(),
});
const unavailable = { source: "unavailable" } as const;
type Order = Pick<
  Tables<"orders">,
  | "id"
  | "user_id"
  | "tenant_id"
  | "checkout_guest_context_hash"
  | "status"
  | "total"
  | "subtotal"
  | "shipping"
  | "tax_amount"
  | "fulfillment"
  | "fulfillment_status"
  | "pickup_instructions"
  | "updated_at"
  | "created_at"
  | "currency"
  | "refund_amount"
  | "checkout_financial_review"
  | "checkout_attempt_guarded"
  | "payment_transaction_id"
  | "square_order_id"
>;
function project(order: Order): ReceiptFinancialEvidence {
  const parsed = evidence.safeParse(order);
  if (!parsed.success) return unavailable;
  const { facts, attempts, refunds, factCount, attemptCount, refundCount } = parsed.data;
  if (
    factCount[0].count !== facts.length ||
    attemptCount[0].count !== attempts.length ||
    refundCount[0].count !== refunds.length
  )
    return unavailable;
  if (order.currency !== null && order.currency !== "USD") return unavailable;
  let review = order.checkout_financial_review;
  const expected = Math.round(Number(order.total) * 100);
  if (
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    expected / 100 !== Number(order.total)
  )
    return unavailable;
  if (
    !order.checkout_attempt_guarded &&
    facts.length === 0 &&
    attempts.length === 0 &&
    refunds.length === 0 &&
    !order.refund_amount
  )
    return { source: "legacy" };
  if (order.currency !== "USD" || expected <= 0) return unavailable;
  const payments = new Map<string, z.infer<typeof attempt>>();
  const attemptsSeen = new Set<string>();
  const sequences = new Set<number>();
  for (const a of attempts) {
    if (
      a.order_id !== order.id ||
      attemptsSeen.has(a.id) ||
      sequences.has(a.sequence) ||
      a.square_order_id !== order.square_order_id ||
      !a.square_order_id ||
      (["pending", "succeeded"].includes(a.state) && !a.provider_payment_id) ||
      (a.state === "ready" && !!a.provider_payment_id)
    )
      return unavailable;
    attemptsSeen.add(a.id);
    sequences.add(a.sequence);
    if (a.provider_payment_id) {
      if (
        payments.has(a.provider_payment_id) ||
        (!order.checkout_attempt_guarded &&
          order.payment_transaction_id !== a.provider_payment_id)
      )
        return unavailable;
      payments.set(a.provider_payment_id, a);
    }
  }
  const versions = new Set<string>();
  const captures = new Map<string, number>();
  const objectBindings = new Map<string, { payment: string; amount: number }>();
  const observedCompletedRefunds = new Set<string>();
  const terminal = new Map<string, string>();
  for (const f of facts) {
    const a = payments.get(f.payment_id);
    if (
      !a ||
      f.order_id !== order.id ||
      (f.kind === "payment" &&
        (f.provider_id !== f.payment_id || f.status === "REJECTED")) ||
      (f.kind === "refund" && ["APPROVED", "CANCELED"].includes(f.status))
    )
      return unavailable;
    const version = JSON.stringify([f.kind, f.provider_id, f.provider_version]);
    if (versions.has(version)) return unavailable;
    versions.add(version);
    const id = f.kind + ":" + f.provider_id;
    const previous = objectBindings.get(id);
    if (previous && previous.payment !== f.payment_id) return unavailable;
    if (previous && previous.amount !== f.amount_cents)
      review ??= "square_amount_conflict";
    objectBindings.set(id, { payment: f.payment_id, amount: f.amount_cents });
    if (
      a.amount_cents !== expected ||
      f.amount_cents > a.amount_cents ||
      (f.kind === "payment" && f.amount_cents !== a.amount_cents)
    )
      review ??= "square_amount_conflict";
    if (f.kind === "refund" && ["COMPLETED", "FAILED", "REJECTED"].includes(f.status)) {
      const prior = terminal.get(id);
      if (prior && prior !== f.status) review ??= "square_status_conflict";
      terminal.set(id, f.status);
    }
    if (f.status === "COMPLETED") {
      if (a.state !== "succeeded") return unavailable;
      if (f.kind === "refund") observedCompletedRefunds.add(f.provider_id);
      if (f.kind === "payment" && a.amount_cents === f.amount_cents)
        captures.set(f.payment_id, a.amount_cents);
    }
  }
  // SQL aggregates the corroborated refund objects, including historical rows, and keeps the persisted floor.
  let completedRefunds = 0;
  const refundIds = new Set<string>();
  for (const r of refunds) {
    if (
      r.order_id !== order.id ||
      r.tenant_id !== order.tenant_id ||
      refundIds.has(r.square_refund_id)
    )
      return unavailable;
    refundIds.add(r.square_refund_id);
    const a = payments.get(r.square_payment_id);
    if (
      !a &&
      (order.checkout_attempt_guarded ||
        order.payment_transaction_id !== r.square_payment_id)
    )
      return unavailable;
    const binding = objectBindings.get("refund:" + r.square_refund_id);
    if (binding && binding.payment !== r.square_payment_id) return unavailable;
    if (binding && binding.amount !== r.amount_cents) review ??= "square_amount_conflict";
    if (r.checkout_status_conflict) review ??= "square_status_conflict";
    if (
      r.status === "COMPLETED" &&
      order.checkout_attempt_guarded &&
      (!binding ||
        binding.amount !== r.amount_cents ||
        a?.state !== "succeeded" ||
        r.amount_cents > a.amount_cents ||
        (!observedCompletedRefunds.has(r.square_refund_id) &&
          !r.checkout_status_conflict))
    )
      return unavailable;
    if (r.status === "COMPLETED") {
      completedRefunds += r.amount_cents;
      observedCompletedRefunds.delete(r.square_refund_id);
    }
  }
  // A historical refund floor survives legacy migration. A guarded projection needs complete independent refund objects.
  if (order.checkout_attempt_guarded && (order.refund_amount ?? 0) > completedRefunds)
    return unavailable;
  if (observedCompletedRefunds.size && !review) return unavailable;
  if (
    captures.size === 1 &&
    (!order.payment_transaction_id || !captures.has(order.payment_transaction_id))
  )
    return unavailable;
  if (captures.size > 1) review ??= "square_multiple_captures";
  const captured = [...captures.values()].reduce((sum, value) => sum + value, 0);
  const refunded = Math.max(
    completedRefunds,
    order.refund_amount ?? 0,
    !order.checkout_attempt_guarded && order.status === "refunded" ? expected : 0,
  );
  if (refunded > expected) review ??= "square_amount_conflict";
  if (
    !order.checkout_attempt_guarded &&
    facts.length === 0 &&
    refunded === 0 &&
    !review &&
    refunds.length === 0
  ) {
    // An inquiry-only attempt is not capture evidence. Retain an explicitly bound historical receipt.
    if (order.payment_transaction_id && payments.has(order.payment_transaction_id))
      return { source: "legacy" };
  }
  return {
    source: "ledger",
    snapshot: financialSnapshot.parse({
      orderId: order.id,
      revision: String(facts.length),
      capturedCents: captured,
      refundedCents: refunded,
      financialState:
        refunded >= expected
          ? "refunded"
          : refunded > 0 ||
              (!order.checkout_attempt_guarded && order.status === "partially_refunded")
            ? "partially_refunded"
            : captured > 0
              ? "paid"
              : "unpaid",
      fulfillmentStatus: order.fulfillment_status ?? "unfulfilled",
      reviewReason: review,
    }),
  };
}

export async function readOrderFinancialEvidence(
  authorized: Order,
  admin?: AdminSupabaseClient,
): Promise<{ order: Order; financial: ReceiptFinancialEvidence }> {
  if (!admin) return { order: authorized, financial: unavailable };
  const { data, error } = await admin
    .from("orders")
    .select(
      "id,user_id,tenant_id,checkout_guest_context_hash,status,total,subtotal,shipping,tax_amount,fulfillment,fulfillment_status,pickup_instructions,updated_at,created_at,currency,refund_amount,checkout_financial_review,checkout_attempt_guarded,payment_transaction_id,square_order_id,facts:checkout_financial_facts(order_id,kind,provider_id,provider_version,payment_id,amount_cents,currency,status),factCount:checkout_financial_facts(count),attempts:checkout_payment_attempts(id,sequence,order_id,provider_payment_id,square_order_id,amount_cents,currency,state),attemptCount:checkout_payment_attempts(count),refunds:square_refunds(order_id,tenant_id,square_refund_id,square_payment_id,status,amount_cents,currency,checkout_status_conflict),refundCount:square_refunds(count)",
    )
    .eq("id", authorized.id)
    .maybeSingle();
  if (error) return { order: authorized, financial: unavailable };
  if (
    !data ||
    data.id !== authorized.id ||
    data.user_id !== authorized.user_id ||
    data.checkout_guest_context_hash !== authorized.checkout_guest_context_hash ||
    data.tenant_id !== authorized.tenant_id
  )
    throw Error("Unauthorized");
  return { order: data, financial: project(data) };
}
