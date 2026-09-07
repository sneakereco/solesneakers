import type { ProductRepository } from "@/repositories/product-repo";
import type { CheckoutReservationItem } from "@/repositories/checkout-reservation-repo";
import type { PrepareCheckoutRequestItem } from "@/lib/checkout/checkout-request";

type CheckoutProductRepository = Pick<ProductRepository, "getProductsForCheckout">;

export type ResolvedCheckoutItem = CheckoutReservationItem;

export type ResolvedCheckoutCart = {
  items: ResolvedCheckoutItem[];
  subtotalCents: number;
};

function checkedMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("checkout_cart_unavailable");
  }
  return value;
}

export async function resolveCheckoutCart(
  repository: CheckoutProductRepository,
  tenantId: string,
  requestedItems: PrepareCheckoutRequestItem[],
): Promise<ResolvedCheckoutCart> {
  const productIds = [...new Set(requestedItems.map((item) => item.productId))];
  const products = await repository.getProductsForCheckout(productIds);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const items: ResolvedCheckoutItem[] = [];
  let subtotalCents = 0;

  for (const requested of requestedItems) {
    const product = productMap.get(requested.productId);
    if (!product || product.tenantId !== tenantId) {
      throw new Error("checkout_cart_unavailable");
    }

    const variant = product.variants.find(
      (candidate) => candidate.id === requested.variantId,
    );
    if (!variant) {
      throw new Error("checkout_cart_unavailable");
    }
    if (variant.stock < requested.quantity) {
      throw new Error("checkout_inventory_unavailable");
    }

    const unitPriceCents = checkedMoney(variant.salePriceCents);
    const unitCostCents = checkedMoney(variant.unitCostCents);
    const lineTotalCents = checkedMoney(unitPriceCents * requested.quantity);
    subtotalCents = checkedMoney(subtotalCents + lineTotalCents);

    items.push({
      productId: product.id,
      variantId: variant.id,
      quantity: requested.quantity,
      unitPriceCents,
      unitCostCents,
      lineTotalCents,
      variantSku: variant.sku,
      productName: product.name,
      brand: product.brand,
      model: product.model,
      category: product.category,
      condition: product.condition,
      sizeLabel: variant.sizeLabel,
    });
  }

  if (items.length !== requestedItems.length || subtotalCents <= 0) {
    throw new Error("checkout_cart_unavailable");
  }

  return { items, subtotalCents };
}
