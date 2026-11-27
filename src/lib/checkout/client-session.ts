import { generateIdempotencyKey } from "@/lib/checkout/idempotency";

const IDEMPOTENCY_KEY = "checkout_idempotency_key";
const CART_FINGERPRINT_KEY = "checkout_cart_fingerprint";
const PENDING_ATTEMPT_KEY = "rdk_checkout_pending_attempt";
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

export function clearCheckoutAttempt(
  key: string,
  storage: Storage | null = getSessionStorage(),
): void {
  try {
    if (storage?.getItem(IDEMPOTENCY_KEY) === key) {
      storage.removeItem(IDEMPOTENCY_KEY);
      storage.removeItem(CART_FINGERPRINT_KEY);
    }
  } catch {
    // A local cleanup failure cannot change the payment outcome.
  }
}

// Remember which tab attempt the processing page can retire once its order is verified.
export function rememberPendingCheckoutAttempt(orderId: string, key: string): void {
  try {
    const storage = getSessionStorage();
    if (storage?.getItem(IDEMPOTENCY_KEY) === key)
      storage.setItem(PENDING_ATTEMPT_KEY, JSON.stringify({ orderId, key }));
  } catch {
    /* Status verification also works without local housekeeping. */
  }
}
export function clearConfirmedCheckoutAttempt(orderId: string): void {
  try {
    const storage = getSessionStorage();
    const pending = JSON.parse(storage?.getItem(PENDING_ATTEMPT_KEY) ?? "null");
    if (pending?.orderId !== orderId || typeof pending.key !== "string") return;
    clearCheckoutAttempt(pending.key, storage);
    storage?.removeItem(PENDING_ATTEMPT_KEY);
  } catch {
    /* A storage failure does not change the confirmed outcome. */
  }
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
