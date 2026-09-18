// src/lib/checkout/guest-shipping-address.ts
export const GUEST_ADDRESS_STORAGE_KEY = "rdk_guest_shipping_address_v1";

export function clearGuestShippingAddress() {
  try {
    sessionStorage.removeItem(GUEST_ADDRESS_STORAGE_KEY);
  } catch {
    // ignore
  }
}
