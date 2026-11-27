import type { OrderStatusResponse } from "@/types/domain/checkout";
import { financialSnapshot } from "../Payments/payment-facts";
import { classifyCheckoutOrderStatus } from "./order-state";
import { z } from "zod";

const date = z.iso.datetime({ offset: true });
const amount = z
  .number()
  .nonnegative()
  .refine(
    (value) =>
      Number.isSafeInteger(Math.round(value * 100)) &&
      Math.round(value * 100) / 100 === value,
  );
const lines = z
  .array(
    z.object({
      productId: z.uuid(),
      variantId: z.uuid(),
      quantity: z.number().int().positive(),
    }),
  )
  .min(1)
  .refine(
    (items) =>
      new Set(items.map((x) => x.productId + "/" + x.variantId)).size === items.length,
  );
export const orderStatus = z.object({
  id: z.uuid(),
  status: z.string().min(1),
  subtotal: amount,
  shipping: amount,
  tax: amount,
  total: amount,
  fulfillment: z.enum(["pickup", "ship"]).nullable(),
  updatedAt: date,
  supportEmail: z.email(),
  pickupInstructions: z.string().nullish(),
  events: z.array(
    z.object({
      type: z.string().min(1),
      message: z.string().nullable(),
      createdAt: date,
    }),
  ),
  financial: z.discriminatedUnion("source", [
    z.object({ source: z.literal("legacy") }),
    z.object({ source: z.literal("unavailable") }),
    z.object({ source: z.literal("ledger"), snapshot: financialSnapshot }),
  ]),
  financialReview: z.boolean().optional(),
  purchasedLines: lines
    .nullable()
    .catch(null)
    .nullish()
    .transform((value) => value ?? null),
});

export type OutcomeState =
  | "waiting"
  | "delayed"
  | "denied"
  | "error"
  | "review"
  | "confirmed"
  | "refunded";
export type Outcome = {
  state: OutcomeState;
  order?: OrderStatusResponse;
};

export function classifyObservedOrder(
  order: Pick<
    OrderStatusResponse,
    "id" | "status" | "total" | "financial" | "financialReview"
  >,
): OutcomeState {
  const classification = classifyCheckoutOrderStatus(order.status);
  if (
    order.financialReview ||
    classification === "review" ||
    order.financial.source === "unavailable"
  )
    return "review";
  if (order.financial.source === "ledger") {
    const s = order.financial.snapshot;
    if (s.orderId !== order.id || s.reviewReason !== null) return "review";
    const expected = Math.round(order.total * 100);
    if (s.financialState === "refunded")
      return expected > 0 && s.refundedCents >= expected ? "refunded" : "review";
    if (s.financialState === "partially_refunded")
      return expected > 0 &&
        s.refundedCents < expected &&
        (s.refundedCents > 0 || order.status === "partially_refunded")
        ? "refunded"
        : "review";
    if (
      s.refundedCents !== 0 ||
      ["refunded", "partially_refunded"].includes(order.status)
    )
      return "review";
    if (s.financialState === "paid" || classification === "paid" || s.capturedCents !== 0)
      return s.financialState === "paid" &&
        s.capturedCents > 0 &&
        s.capturedCents === Math.round(order.total * 100) &&
        classification === "paid"
        ? "confirmed"
        : "review";
  } else {
    if (classification === "paid") return "confirmed";
    if (["refunded", "partially_refunded"].includes(order.status)) return "refunded";
  }
  return classification === "waiting" ? "waiting" : "error";
}
