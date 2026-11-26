import type { BasketLine } from "../../Contracts/Basket";
import type { ValidationOrder } from "./validation-contract";
import { reconcileValidation } from "./reconcile-validation";
export async function requestValidation(
  items: BasketLine[],
  order?: ValidationOrder,
): Promise<BasketLine[] | undefined> {
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
        ...(order ? { order } : {}),
      }),
    });
    if (!response.ok) return;
    const result = reconcileValidation(items, await response.json());
    if (result.kind === "apply") return result.items;
  } catch {
    /* Retry leaves the captured snapshot intact. */
  }
}
