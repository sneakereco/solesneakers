import {
  getOrCreateCheckoutDeviceSessionId,
  getOrCreateCheckoutIdempotencyKey,
  readGuestOrderAccess,
  storeGuestOrderAccess,
} from "@/lib/checkout/client-session";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("checkout client session", () => {
  it("reuses an idempotency key only while the cart fingerprint is unchanged", () => {
    const storage = memoryStorage();
    const createId = jest
      .fn()
      .mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444");

    expect(getOrCreateCheckoutIdempotencyKey("cart-a", storage, createId)).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(getOrCreateCheckoutIdempotencyKey("cart-a", storage, createId)).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(getOrCreateCheckoutIdempotencyKey("cart-b", storage, createId)).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it("keeps one opaque device identifier for the browser session", () => {
    const storage = memoryStorage();
    const createId = jest.fn().mockReturnValue("55555555-5555-4555-8555-555555555555");

    expect(getOrCreateCheckoutDeviceSessionId(storage, createId)).toBe(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(getOrCreateCheckoutDeviceSessionId(storage, createId)).toBe(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("stores guest access by order without putting the token in the redirect URL", () => {
    const storage = memoryStorage();

    storeGuestOrderAccess("order-1", "secret-token", storage);

    expect(readGuestOrderAccess("order-1", storage)).toBe("secret-token");
    expect(readGuestOrderAccess("order-2", storage)).toBeNull();
  });
});
