import { generateIdempotencyKey } from "@/lib/checkout/idempotency";

const IDEMPOTENCY_KEY = "checkout_idempotency_key";
const CART_FINGERPRINT_KEY = "checkout_cart_fingerprint";

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

export function isCurrentCheckoutAttempt(
  key: string,
  fingerprint: string,
  storage = getSessionStorage(),
) {
  try {
    return (
      !!storage &&
      storage.getItem(IDEMPOTENCY_KEY) === key &&
      storage.getItem(CART_FINGERPRINT_KEY) === fingerprint
    );
  } catch {
    return false;
  }
}
export {
  getOrCreateCheckoutDeviceSessionId,
  storeGuestOrderAccess,
  readGuestOrderAccess,
} from "@/Modules/Checkout/Source/Features/Outcomes/client-session";
