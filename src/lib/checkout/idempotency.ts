// src/lib/idempotency.ts

/**
 * Generate a UUID v4 idempotency key (client-safe)
 */
export function generateIdempotencyKey(): string {
  // Use crypto.randomUUID() if available (modern browsers)
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  // Fallback: generate UUID v4 manually
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function clearIdempotencyKeyFromStorage(): void {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.removeItem("checkout_idempotency_key");
  sessionStorage.removeItem("checkout_cart_fingerprint");
}
