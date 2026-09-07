import { createHash } from "node:crypto";

import type { PrepareCheckoutRequest } from "@/lib/checkout/checkout-request";

type CheckoutCartHashInput = Pick<
  PrepareCheckoutRequest,
  "items" | "fulfillment" | "shippingAddress"
> & {
  tenantId: string;
  buyerEmail: string;
};

export function createCheckoutCartHash(input: CheckoutCartHashInput): string {
  const items = [...input.items].sort((left, right) => {
    const leftKey = `${left.productId}:${left.variantId}`;
    const rightKey = `${right.productId}:${right.variantId}`;
    return leftKey.localeCompare(rightKey);
  });

  const canonical = JSON.stringify({
    version: 1,
    tenantId: input.tenantId,
    buyerEmail: input.buyerEmail,
    fulfillment: input.fulfillment,
    shippingAddress: input.shippingAddress ?? null,
    items,
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
