import { z } from "zod";

import type { BasketRepairReason, CartItem } from "../../Contracts/Basket";

// Separate from checkout request limits and private purchase-proof bounds.
export class SavedBasketLimitError extends Error {
  constructor(readonly reason: Exclude<BasketRepairReason, null>) {
    super(reason);
  }
}
export function checkSavedLength(length: number) {
  if (length > 2_000_000) throw new SavedBasketLimitError("too_large");
}
export function checkSavedCount(count: number) {
  if (count > 4096) throw new SavedBasketLimitError("too_many_rows");
}

// Older saved lines can lack the optional stock cap or a usable image.
const storedLine = z.looseObject({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  sizeLabel: z.string(),
  brand: z.string(),
  name: z.string(),
  titleDisplay: z.string(),
  priceCents: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  imageUrl: z.string().nullish(),
  maxStock: z.number().int().nonnegative().optional(),
});

export function decodeSavedBasket(raw: string | null): {
  items: CartItem[];
  complete: boolean;
} {
  if (raw === null) return { items: [], complete: true };
  checkSavedLength(raw.length);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { items: [], complete: false };
  }
  if (!Array.isArray(value)) return { items: [], complete: false };
  checkSavedCount(value.length);
  const items: CartItem[] = [];
  for (const row of value) {
    const parsed = storedLine.safeParse(row);
    if (!parsed.success) continue;
    const line = parsed.data;
    items.push({
      ...line,
      imageUrl:
        !line.imageUrl || line.imageUrl === "/placeholder.png"
          ? "/images/logo.png"
          : line.imageUrl,
    });
  }
  return { items, complete: items.length === value.length };
}
