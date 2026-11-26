import type { OrderStatusResponse } from "@/types/domain/checkout";
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
