import { z } from "zod";
import { stockShortages, type CartItem } from "../../Contracts/Basket";
export type { Shortage, ValidationOrder } from "../../Contracts/Basket";
export const shortage = z.enum(stockShortages);
export const availability = z.enum(["available", ...shortage.options]);
const pair = { productId: z.string().min(1), variantId: z.string().min(1) };
const stock = z.number().int().nonnegative();
const positive = z.number().int().positive();
export const catalogFacts = z.object({
  sizeLabel: z.string(),
  brand: z.string(),
  name: z.string(),
  titleDisplay: z.string(),
  priceCents: stock,
  imageUrl: z.string().nullish(),
});
const validatedLine = catalogFacts.extend({
  ...pair,
  quantity: positive,
  maxStock: positive,
});
const removal = z.object({
  ...pair,
  reason: z.enum(["not_found", "out_of_stock", "insufficient_stock"]),
});
export const legacyReply = z.object({
  items: z.array(validatedLine),
  removed: z.array(removal),
});
export const lineState = z
  .strictObject({
    productId: z.uuid(),
    variantId: z.uuid(),
    requestedQuantity: positive,
    availableQuantity: stock,
    availability,
    reason: availability,
    orderScoped: z.literal(true).optional(),
    facts: catalogFacts.optional(),
  })
  .refine(
    (s) =>
      s.reason === s.availability &&
      (s.availability === "available") === s.availableQuantity >= s.requestedQuantity &&
      (s.availability !== "sold_out" || s.availableQuantity === 0),
  );
export const v2Reply = legacyReply.extend({
  contractVersion: z.literal(2),
  lineState: z.array(lineState),
});
export type LineState = z.infer<typeof lineState>;
export type LegacyRemoval = z.infer<typeof removal>;
export type CartValidationV2 = {
  contractVersion: 2;
  items: CartItem[];
  removed: LegacyRemoval[];
  lineState: LineState[];
};
export function basketImage(url: string | null | undefined) {
  return !url || url === "/placeholder.png" ? "/images/logo.png" : url;
}
