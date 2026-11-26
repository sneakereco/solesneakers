import { z } from "zod";

const money = z.number().int().positive().max(2147483647);
const id = z.string().regex(/^[A-Za-z0-9._:=+-]{1,192}$/);
export const financialFact = z
  .strictObject({
    kind: z.enum(["payment", "refund"]),
    providerId: id,
    paymentId: id,
    orderId: z.uuid(),
    providerVersion: z.string().min(1).max(256),
    status: z.enum([
      "PENDING",
      "APPROVED",
      "COMPLETED",
      "FAILED",
      "CANCELED",
      "REJECTED",
    ]),
    amountCents: money,
    currency: z.literal("USD"),
    expectedTotalCents: money,
    fulfillmentStatus: z.string().min(1).max(80),
  })
  .refine((f) => f.kind !== "payment" || f.paymentId === f.providerId);
export type VerifiedFinancialFact = z.infer<typeof financialFact>;

export const financialSnapshot = z.strictObject({
  orderId: z.uuid(),
  revision: z.string().min(1),
  financialState: z.enum(["unpaid", "paid", "partially_refunded", "refunded"]),
  capturedCents: z.number().int().nonnegative(),
  refundedCents: z.number().int().nonnegative(),
  fulfillmentStatus: z.string(),
  reviewReason: z.string().nullable(),
});
export type FinancialSnapshot = z.infer<typeof financialSnapshot>;

export function projectOrderFinancialState(
  facts: readonly VerifiedFinancialFact[],
): FinancialSnapshot {
  const first = facts[0];
  if (!first) throw new Error("Missing financial facts");
  const captures = new Map<string, number>();
  const refundPayments = new Map<string, string>();
  const terminalRefunds = new Map<string, string>();
  let statusConflict = false;
  let reviewReason: string | null = null;
  const refunds = new Map<string, number>();
  const versions = new Set<string>();
  const fulfillment = new Set(facts.map((f) => f.fulfillmentStatus));
  for (const value of facts) {
    const f = financialFact.parse(value);
    if (f.orderId !== first.orderId || f.expectedTotalCents !== first.expectedTotalCents)
      throw new Error("Financial fact binding mismatch");
    versions.add(JSON.stringify([f.kind, f.providerId, f.providerVersion]));
    if (
      (f.kind === "payment" && f.amountCents !== first.expectedTotalCents) ||
      f.amountCents > first.expectedTotalCents
    ) {
      reviewReason = "square_amount_conflict";
      continue;
    }
    if (f.kind === "refund") {
      const binding = refundPayments.get(f.providerId);
      if (binding && binding !== f.paymentId)
        throw new Error("Financial fact binding mismatch");
      refundPayments.set(f.providerId, f.paymentId);
      if (["COMPLETED", "FAILED", "REJECTED"].includes(f.status)) {
        const terminal = terminalRefunds.get(f.providerId);
        if (terminal && terminal !== f.status) statusConflict = true;
        terminalRefunds.set(f.providerId, f.status);
      }
    }
    if (f.status !== "COMPLETED") continue;
    if (f.kind === "payment") captures.set(f.paymentId, f.amountCents);
    else {
      const existing = refunds.get(f.providerId);
      if (existing !== undefined && existing !== f.amountCents)
        throw new Error("refund_refresh_required");
      refunds.set(f.providerId, f.amountCents);
    }
  }
  const capturedCents = [...captures.values()].reduce((a, b) => a + b, 0);
  if (captures.size > 1) reviewReason ??= "square_multiple_captures";
  if (statusConflict) reviewReason ??= "square_status_conflict";
  const refundedCents = [...refunds.values()].reduce((a, b) => a + b, 0);
  if (refundedCents > first.expectedTotalCents) reviewReason = "square_amount_conflict";
  const fulfillmentStatus =
    ["delivered", "picked_up", "shipped", "ready_to_ship", "unfulfilled"].find((s) =>
      fulfillment.has(s),
    ) ?? [...fulfillment].sort()[0];
  return {
    orderId: first.orderId,
    revision: String(versions.size),
    capturedCents,
    refundedCents,
    financialState:
      refundedCents >= first.expectedTotalCents
        ? "refunded"
        : refundedCents
          ? "partially_refunded"
          : capturedCents
            ? "paid"
            : "unpaid",
    fulfillmentStatus,
    reviewReason,
  };
}
