// src/lib/validation/cart.ts
import { z } from "zod";

export const cartValidateSchema = z
  .object({
    order: z
      .strictObject({
        orderId: z.uuid(),
        guestAccessToken: z.string().min(1).max(2048).optional(),
      })
      .optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          variantId: z.string().uuid(),
          quantity: z.number().int().positive(),
        }),
      )
      .max(4096)
      .refine(
        (lines) =>
          new Set(lines.map((r) => r.productId + "/" + r.variantId)).size ===
          lines.length,
      )
      .default([]),
  })
  .strict();
