import { generateIdempotencyKey } from "@/lib/checkout/idempotency";

const IDEMPOTENCY_KEY = "checkout_idempotency_key";
const CART_FINGERPRINT_KEY = "checkout_cart_fingerprint";
const DEVICE_SESSION_KEY = "rdk_checkout_device_session_id";
const GUEST_ORDER_ID_KEY = "rdk_guest_order_id";
const GUEST_ORDER_TOKEN_KEY = "rdk_guest_order_token";

function getSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getOrCreateCheckoutIdempotencyKey(
  cartFingerprint: string,
  storage: Storage | null = getSessionStorage(),
  createId: () => string = generateIdempotencyKey,
): string {
  const existingKey = storage?.getItem(IDEMPOTENCY_KEY);
  const existingFingerprint = storage?.getItem(CART_FINGERPRINT_KEY);
  if (existingKey && existingFingerprint === cartFingerprint) {
    return existingKey;
  }

  const key = createId();
  storage?.setItem(IDEMPOTENCY_KEY, key);
  storage?.setItem(CART_FINGERPRINT_KEY, cartFingerprint);
  return key;
}

export function getOrCreateCheckoutDeviceSessionId(
  storage: Storage | null = getSessionStorage(),
  createId: () => string = generateIdempotencyKey,
): string {
  const existing = storage?.getItem(DEVICE_SESSION_KEY);
  if (existing) {
    return existing;
  }

  const id = createId();
  storage?.setItem(DEVICE_SESSION_KEY, id);
  return id;
}

export function storeGuestOrderAccess(
  orderId: string,
  token: string,
  storage: Storage | null = getSessionStorage(),
): void {
  storage?.setItem(GUEST_ORDER_ID_KEY, orderId);
  storage?.setItem(GUEST_ORDER_TOKEN_KEY, token);
}

export function readGuestOrderAccess(
  orderId: string,
  storage: Storage | null = getSessionStorage(),
): string | null {
  if (storage?.getItem(GUEST_ORDER_ID_KEY) !== orderId) {
    return null;
  }
  return storage.getItem(GUEST_ORDER_TOKEN_KEY);
}
