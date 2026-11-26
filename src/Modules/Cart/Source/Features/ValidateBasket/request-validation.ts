import { z } from "zod";
import type { CartItem } from "../../Contracts/Basket";

const validatedLine = z.object({
  productId: z.string(),
  variantId: z.string(),
  sizeLabel: z.string(),
  brand: z.string(),
  name: z.string(),
  titleDisplay: z.string(),
  priceCents: z.number().int().nonnegative(),
  imageUrl: z.string().min(1),
  quantity: z.number().int().positive(),
  maxStock: z.number().int().positive(),
});
const removal = z.object({
  productId: z.string(),
  variantId: z.string(),
  reason: z.enum(["not_found", "out_of_stock", "insufficient_stock"]),
});
const validationReply = z.object({
  items: z.array(validatedLine),
  removed: z.array(removal),
});
function lineKey(line: Pick<CartItem, "productId" | "variantId">) {
  return JSON.stringify([line.productId, line.variantId]);
}
function reconcile(items: CartItem[], reply: z.infer<typeof validationReply>) {
  const remaining = new Map(items.map((line) => [lineKey(line), line.quantity]));
  if (remaining.size !== items.length) return;
  for (const line of reply.items) {
    const key = lineKey(line),
      requested = remaining.get(key);
    if (
      requested === undefined ||
      line.quantity > requested ||
      line.quantity > line.maxStock
    )
      return;
    remaining.delete(key);
  }
  for (const removed of reply.removed) if (!remaining.delete(lineKey(removed))) return;
  if (remaining.size === 0) return reply.items;
}

export async function requestValidation(
  items: CartItem[],
): Promise<CartItem[] | undefined> {
  try {
    const response = await fetch("/api/cart/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map(({ productId, variantId, quantity }) => ({
          productId,
          variantId,
          quantity,
        })),
      }),
    });
    if (!response.ok) return;
    const reply = validationReply.safeParse(await response.json());
    if (reply.success) return reconcile(items, reply.data);
  } catch {
    // A failed refresh leaves the saved basket available for the next retry.
  }
}
