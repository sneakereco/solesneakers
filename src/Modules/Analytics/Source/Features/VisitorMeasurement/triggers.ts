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
