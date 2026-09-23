export function enteredStorefront(
  previousPathname: string | null,
  pathname: string,
): boolean {
  return pathname === "/store" && previousPathname !== "/store";
}

export function hasUsableCheckout(input: {
  cartReady: boolean;
  itemCount: number;
  isRedirecting: boolean;
}): boolean {
  return input.cartReady && input.itemCount > 0 && !input.isRedirecting;
}
