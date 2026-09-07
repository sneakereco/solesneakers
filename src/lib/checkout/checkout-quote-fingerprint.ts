import { createHash } from "node:crypto";

import type {
  CheckoutQuoteRequest,
  CheckoutTotals,
} from "@/lib/checkout/checkout-request";

export type ExactCheckoutQuoteInput = {
  items: Array<{ variantId: string; quantity: number; unitPriceCents: number }>;
  fulfillment: CheckoutQuoteRequest["fulfillment"];
  shippingAddress: CheckoutQuoteRequest["shippingAddress"];
  totals: CheckoutTotals;
};

export function createCheckoutQuoteFingerprint(input: ExactCheckoutQuoteInput): string {
  const canonical = {
    fulfillment: input.fulfillment,
    shippingAddress: input.shippingAddress,
    items: [...input.items].sort((a, b) => a.variantId.localeCompare(b.variantId)),
    totals: input.totals,
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
