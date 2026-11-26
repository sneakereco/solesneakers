import { capture } from "./client";
export function captureStorefrontViewed() {
  capture({ event: "storefront_viewed" });
}
export function captureProductViewed(productId: string) {
  capture({ event: "product_viewed", product_id: productId });
}
export function captureProductAddedToCart(productId: string, variantId: string) {
  capture({
    event: "product_added_to_cart",
    product_id: productId,
    variant_id: variantId,
    quantity: 1,
  });
}
export function captureCatalogSearchResults(
  resultCount: number,
  query: string,
  products: readonly {
    id: string;
    name: string;
    brand?: { id: string; label: string } | null;
    model?: { id: string; label: string } | null;
  }[],
) {
  const term = query.trim().toLowerCase();
  for (const product of products) {
    for (const [kind, concept] of [
      ["product", { id: product.id, label: product.name }],
      ["brand", product.brand],
      ["model", product.model],
    ] as const) {
      if (
        concept &&
        typeof concept.label === "string" &&
        term &&
        concept.label.trim().toLowerCase() === term
      ) {
        capture({
          event: "catalog_search_results",
          result_count: resultCount,
          concept_kind: kind,
          concept_id: concept.id,
        });
        return;
      }
    }
  }
  capture({ event: "catalog_search_results", result_count: resultCount });
}
export function captureVariantSelection(
  productId: string,
  variantId: string,
  available: boolean,
) {
  capture({
    event: available ? "variant_selected" : "unavailable_size_requested",
    product_id: productId,
    variant_id: variantId,
  });
}
export function captureStockoutView(productId: string) {
  capture({ event: "out_of_stock_viewed", product_id: productId });
}
export function captureCheckoutStarted() {
  capture({ event: "checkout_started" });
}
export function enteredStorefront(previous: string | null, pathname: string) {
  return pathname === "/store" && previous !== "/store";
}
export function hasUsableCheckout(input: {
  cartReady: boolean;
  itemCount: number;
  isRedirecting: boolean;
}) {
  return input.cartReady && input.itemCount > 0 && !input.isRedirecting;
}
