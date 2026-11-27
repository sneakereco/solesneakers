import {
  getOrCreateCheckoutDeviceSessionId,
  observeStoredGuestAccess,
  resolveCheckoutAttempt,
  readGuestOrderAccess,
  readPreparedScope,
  storeGuestOrderAccess,
} from "@/Modules/Checkout/Source/Features/Outcomes/client-session";

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

    const first = resolveCheckoutAttempt("cart-a", storage, createId);
    expect(first.mode).toBe("new");
    expect(storage.length).toBe(0);
    expect(first.commit()).toBe(true);
    const resumed = resolveCheckoutAttempt("cart-a", storage, createId);
    expect(resumed.mode).toBe("resume");
    expect(resumed.key).toBe(first.key);
    const changed = resolveCheckoutAttempt("cart-b", storage, createId);
    expect(changed.key).not.toBe(first.key);
    expect(changed.commit()).toBe(true);
    expect(first.reject()).toBe(false);
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

test("a damaged prepared record without an originating issued pair cannot restore an order scope", () => {
  const storage = memoryStorage();
  storage.setItem(
    "checkout_prepared_housekeeping_v1",
    JSON.stringify({
      orderId: "10000000-0000-4000-8000-000000000001",
      ownerId: "account-a",
    }),
  );
  expect(readPreparedScope("account-a", storage)).toBeNull();
});

it("retains the exact committed guest pair on equivalent publication and permanently retires it after another grant", () => {
  const storage = memoryStorage();
  storeGuestOrderAccess("B", "token-B", storage);
  const current = observeStoredGuestAccess(storage);
  storeGuestOrderAccess("B", "token-B", storage);
  expect(current()).toBe(true);
  storeGuestOrderAccess("C", "token-C", storage);
  storeGuestOrderAccess("B", "token-B", storage);
  expect(current()).toBe(false);
  expect(observeStoredGuestAccess(storage)()).toBe(true);
});
