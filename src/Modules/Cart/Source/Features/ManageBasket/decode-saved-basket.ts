import { z } from "zod";
import { decodeUnits, uniqueLines, type SavedLine } from "./purchase-capture";

import type { BasketRepairReason, CartItem } from "../../Contracts/Basket";

// Separate from checkout request limits and private purchase-proof bounds.
export const maxSavedLength = 2_000_000;
export const maxSavedCount = 4096;
export class SavedBasketLimitError extends Error {
  constructor(readonly reason: Exclude<BasketRepairReason, null>) {
    super(reason);
  }
}
export function checkSavedLength(length: number) {
  if (length > maxSavedLength) throw new SavedBasketLimitError("too_large");
}
export function checkSavedCount(count: number) {
  if (count > maxSavedCount) throw new SavedBasketLimitError("too_many_rows");
}

// Older saved lines can lack the optional stock cap or a usable image.
const storedLine = z.object({
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
  rows: SavedLine[];
  complete: boolean;
} {
  if (raw === null) return { items: [], rows: [], complete: true };
  checkSavedLength(raw.length);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { items: [], rows: [], complete: false };
  }
  if (!Array.isArray(value)) return { items: [], rows: [], complete: false };
  checkSavedCount(value.length);
  const rows: SavedLine[] = [];
  for (const row of value) {
    const parsed = storedLine.safeParse(row);
    if (!parsed.success) continue;
    const line = parsed.data;
    rows.push({
      units: Object.hasOwn(row, "_cartUnits")
        ? decodeUnits(row._cartUnits, line.quantity)
        : undefined,
      item: {
        ...line,
        imageUrl:
          !line.imageUrl || line.imageUrl === "/placeholder.png"
            ? "/images/logo.png"
            : line.imageUrl,
      },
    });
  }
  const items = rows.map((row) => row.item);
  const ids = rows.flatMap((row) => (row.units ? [row.units.id] : []));
  return {
    items,
    rows,
    complete:
      rows.length === value.length &&
      uniqueLines(items) &&
      new Set(ids).size === ids.length,
  };
}
