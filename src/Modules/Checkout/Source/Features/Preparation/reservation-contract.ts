import { z } from "zod";
export const inventoryConflict = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    requestedQuantity: z.number().int().min(1).max(5),
    availableQuantity: z.number().int().nonnegative(),
    reason: z.enum(["reserved_by_other", "sold_out", "unavailable"]),
  })
  .strict()
  .refine((c) => c.availableQuantity < c.requestedQuantity);
export type InventoryConflict = z.infer<typeof inventoryConflict>;
export const reserved = z
  .object({
    kind: z.literal("reserved"),
    orderId: z.string().uuid(),
    expiresAt: z.string().datetime({ offset: true }),
    reused: z.boolean(),
  })
  .strict();
export type ReservationDecision =
  | z.infer<typeof reserved>
  | { kind: "conflict"; conflicts: InventoryConflict[] };
export class PreparationChanged extends Error {}
export class PreparationRecoveryRequired extends Error {}
