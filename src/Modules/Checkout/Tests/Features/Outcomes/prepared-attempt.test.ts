import { recoverOriginalOrder } from "../../../Source/Features/Outcomes/original-order-recovery";
import { capturePreparedAttempt } from "../../../Source/Features/Outcomes/prepared-attempt";
import {
  resolveCheckoutAttempt,
  storeGuestOrderAccess,
  readGuestOrderAccess,
  finishCheckoutAttempt,
  getOrCreateCheckoutDeviceSessionId,
} from "../../../Source/Features/Outcomes/client-session";
import type { CartPurchaseActions, CaptureResult } from "@/Modules/Cart/Source/Client";
const lines = [{ productId: "p", variantId: "v", quantity: 1 }];
const fingerprint = JSON.stringify;
const legacyKey = "11111111-1111-4111-8111-111111111111";
const attemptKey = "checkout_idempotency_key",
  cartKey = "checkout_cart_fingerprint";
let values: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
beforeEach(() => {
  values = new Map();
  storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => void values.set(k, v),
    removeItem: (k) => void values.delete(k),
  };
  Object.defineProperty(global, "window", {
    configurable: true,
    value: { crypto: global.crypto, sessionStorage: storage, dispatchEvent: jest.fn() },
  });
});
afterEach(() => Reflect.deleteProperty(global, "window"));
function actions(result: CaptureResult): CartPurchaseActions {
  return {
    captureForCheckout: jest.fn().mockResolvedValue(result),
    bindPreparedOrder: jest.fn().mockResolvedValue(true),
    consumeConfirmedPurchase: jest.fn(),
  };
}
const captured: CaptureResult = {
  status: "captured",
  captureId: "original",
  items: lines,
};
const issue = (
  cart: CartPurchaseActions,
  signal = new AbortController().signal,
  view = () => true,
) => capturePreparedAttempt(cart, lines, fingerprint, signal, jest.fn(), view);
it.each(["missing", "mismatch", "stale", "corrupt", "unavailable"] as const)(
  "fresh %s capture never persists or dispatches an attempt",
  async (status) => {
    await expect(issue(actions({ status }))).rejects.toThrow("checkout changed");
    expect(values.size).toBe(0);
  },
);
it("persists the key only after capture and before prepare; an older callback cannot overwrite a changed pair", async () => {
  let release!: (value: CaptureResult) => void;
  const cart = actions(captured);
  cart.captureForCheckout = jest.fn(() => new Promise((r) => (release = r)));
  const pending = issue(cart);
  expect(values.size).toBe(0);
  values.set(attemptKey, "newer");
  values.set(cartKey, "newer-request");
  release(captured);
  await expect(pending).rejects.toThrow("checkout changed");
  expect(values.get(attemptKey)).toBe("newer");
});
it.each(["missing", "corrupt"] as const)(
  "resumes financial key with %s legacy proof without binding or housekeeping",
  async (status) => {
    values.set(attemptKey, legacyKey);
    values.set(cartKey, fingerprint(lines));
    const cart = actions({ status });
    const attempt = await issue(cart);
    expect(cart.captureForCheckout).toHaveBeenCalledWith(
      {
        mode: "resume",
        attemptKey: legacyKey,
        expectedItems: lines,
      },
      expect.any(AbortSignal),
    );
    await attempt.prepared("order");
    expect(cart.bindPreparedOrder).not.toHaveBeenCalled();
    finishCheckoutAttempt("order", legacyKey);
    expect(values.get(attemptKey)).toBe(legacyKey);
  },
);
it("retains a dispatched financial key when binding fails", async () => {
  const cart = actions(captured);
  cart.bindPreparedOrder = jest.fn().mockRejectedValue(Error("storage denied"));
  const attempt = await issue(cart);
  await attempt.prepared("order", "guest");
  expect(values.get(attemptKey)).toBe(attempt.key);
  finishCheckoutAttempt("order", attempt.key);
  expect(values.get(attemptKey)).toBe(attempt.key);
});
it("rejects an identity change while the original binding is pending", async () => {
  const cart = actions(captured);
  const controller = new AbortController();
  let release!: (v: boolean) => void;
  cart.bindPreparedOrder = jest.fn(() => new Promise((r) => (release = r)));
  const attempt = await issue(cart, controller.signal);
  const binding = attempt.prepared("order", "guest");
  controller.abort();
  release(true);
  await expect(binding).rejects.toThrow("checkout changed");
  expect(values.get("rdk_guest_order_token")).toBeUndefined();
});
it("does not clear a newer same-key fingerprint or newer credentials", async () => {
  const attempt = await issue(actions(captured));
  values.set("rdk_guest_order_id", "new-order");
  values.set("rdk_guest_order_token", "new-token");
  await attempt.prepared("order", "older");
  values.set(cartKey, "changed");
  finishCheckoutAttempt("order", attempt.key);
  expect(values.get(attemptKey)).toBe(attempt.key);
  expect(values.get("rdk_guest_order_token")).toBe("new-token");
});
it("resumes interrupted housekeeping from the matched receipt", async () => {
  const attempt = await issue(actions(captured));
  await attempt.prepared("order", "guest");
  const remove = storage.removeItem;
  let fail = true;
  storage.removeItem = (k) => {
    if (k === cartKey && fail) throw Error("interrupted");
    remove(k);
  };
  finishCheckoutAttempt("order", attempt.key);
  expect(values.get(cartKey)).toBe(fingerprint(lines));
  expect(values.get(attemptKey)).toBe(attempt.key);
  fail = false;
  finishCheckoutAttempt("order", attempt.key);
  expect(values.has(cartKey)).toBe(false);
  expect(values.get("rdk_guest_order_token")).toBe("guest");
});

it("requires a current rendered view to reuse a financial key without shopping evidence", async () => {
  values.set(attemptKey, legacyKey);
  values.set(cartKey, fingerprint(lines));
  await expect(
    issue(actions({ status: "missing" }), new AbortController().signal, () => false),
  ).rejects.toThrow("checkout changed");
  expect(values.get(attemptKey)).toBe(legacyKey);
});

it.each([attemptKey, cartKey])("keeps A recoverable after B cannot publish %s", (key) => {
  const a = resolveCheckoutAttempt("A");
  a.commit();
  const b = resolveCheckoutAttempt("B");
  const set = storage.setItem;
  storage.setItem = (k, v) => {
    if (k === key) {
      storage.setItem = set;
      throw Error("quota");
    }
    set(k, v);
  };
  expect(() => b.commit()).toThrow();
  const reloaded = resolveCheckoutAttempt("A");
  expect(reloaded.mode).toBe("resume");
  expect(reloaded.key).toBe(a.key);
});
it.each(["rdk_guest_order_id", "rdk_guest_order_token"])(
  "keeps A guest credential after failed B write to %s",
  (key) => {
    storeGuestOrderAccess("A", "token-A");
    const set = storage.setItem;
    storage.setItem = (k, v) => {
      if (k === key) {
        storage.setItem = set;
        throw Error("quota");
      }
      set(k, v);
    };
    expect(() => storeGuestOrderAccess("B", "token-B")).toThrow();
    expect(readGuestOrderAccess("A")).toBe("token-A");
    expect(readGuestOrderAccess("B")).toBeNull();
  },
);
it("blocks a damaged legacy financial pair from becoming a fresh attempt", () => {
  values.set(attemptKey, "issued-A");
  expect(() => resolveCheckoutAttempt("A")).toThrow();
});

it.each([
  "checkout_attempt_rollback_v1",
  "checkout_idempotency_key",
  "checkout_cart_fingerprint",
])(
  "recovers A on reload even if storage remains read-only after failing on %s",
  (failure) => {
    const a = resolveCheckoutAttempt("A");
    a.commit();
    const b = resolveCheckoutAttempt("B");
    const set = storage.setItem,
      remove = storage.removeItem;
    let blocked = false;
    storage.setItem = (k, v) => {
      if (k === failure) blocked = true;
      if (blocked) throw Error("denied");
      set(k, v);
    };
    storage.removeItem = (k) => {
      if (blocked) throw Error("denied");
      remove(k);
    };
    expect(() => b.commit()).toThrow();
    expect(resolveCheckoutAttempt("A").key).toBe(a.key);
    storage.setItem = set;
    storage.removeItem = remove;
    expect(resolveCheckoutAttempt("A").commit()).toBe(true);
    expect(values.get(attemptKey)).toBe(a.key);
    expect(values.get(cartKey)).toBe("A");
    expect(values.has("checkout_attempt_rollback_v1")).toBe(false);
  },
);
it.each([
  "checkout_idempotency_key",
  "checkout_cart_fingerprint",
  "checkout_attempt_rollback_v1",
  "checkout_prepared_housekeeping_v1",
])("resumes exact housekeeping after removal failure at %s", (failure) => {
  const a = resolveCheckoutAttempt("A");
  a.commit();
  a.prepared("order", undefined, true);
  const remove = storage.removeItem;
  storage.removeItem = (k) => {
    if (k === failure) throw Error("denied");
    remove(k);
  };
  finishCheckoutAttempt("order", a.key);
  storage.removeItem = remove;
  finishCheckoutAttempt("order", a.key);
  expect(values.has(attemptKey)).toBe(false);
  expect(values.has(cartKey)).toBe(false);
  expect(values.has("checkout_attempt_rollback_v1")).toBe(false);
  expect(values.has("checkout_prepared_housekeeping_v1")).toBe(false);
  expect(resolveCheckoutAttempt("A").key).not.toBe(a.key);
});
it.each(["checkout_attempt_rollback_v1", "checkout_guest_rollback_v1"])(
  "damaged journal %s cannot expose an obsolete pair",
  (key) => {
    values.set(attemptKey, "old");
    values.set(cartKey, "A");
    values.set("rdk_guest_order_id", "order");
    values.set("rdk_guest_order_token", "guest");
    values.set(key, "bad JSON");
    if (key === "checkout_attempt_rollback_v1")
      expect(() => resolveCheckoutAttempt("A")).toThrow();
    else expect(readGuestOrderAccess("order")).toBeNull();
  },
);

it.each(["checkout_guest_rollback_v1", "rdk_guest_order_id", "rdk_guest_order_token"])(
  "preserves the guest read after continuous write denial at %s",
  (failure) => {
    storeGuestOrderAccess("A", "token-A");
    const set = storage.setItem,
      remove = storage.removeItem;
    let blocked = false;
    storage.setItem = (k, v) => {
      if (k === failure) blocked = true;
      if (blocked) throw Error("denied");
      set(k, v);
    };
    storage.removeItem = (k) => {
      if (blocked) throw Error("denied");
      remove(k);
    };
    expect(() => storeGuestOrderAccess("B", "token-B")).toThrow();
    expect(readGuestOrderAccess("A")).toBe("token-A");
    expect(readGuestOrderAccess("B")).toBeNull();
    storage.setItem = set;
    storage.removeItem = remove;
    storeGuestOrderAccess("A", "token-A");
    expect(values.get("rdk_guest_order_id")).toBe("A");
    expect(values.get("rdk_guest_order_token")).toBe("token-A");
    expect(values.has("checkout_guest_rollback_v1")).toBe(false);
  },
);
it("refuses a stale resumed capture unless its exact issued pair has an interrupted replacement", async () => {
  const attempt = resolveCheckoutAttempt(fingerprint(lines));
  attempt.commit();
  await expect(issue(actions({ status: "stale" }))).rejects.toThrow("checkout changed");
  const next = resolveCheckoutAttempt("next");
  next.protectIssuedAttempt();
  await expect(issue(actions({ status: "mismatch" }))).rejects.toThrow(
    "checkout changed",
  );
  await expect(
    issue(actions({ status: "stale" }), new AbortController().signal, () => false),
  ).rejects.toThrow("checkout changed");
  const controller = new AbortController();
  controller.abort();
  await expect(issue(actions({ status: "stale" }), controller.signal)).rejects.toThrow(
    "checkout changed",
  );
  next.rejectCapture();
  await expect(issue(actions({ status: "stale" }))).rejects.toThrow("checkout changed");
});
it("refuses to retire A evidence when the switch guard cannot be stored", async () => {
  const previous = resolveCheckoutAttempt("A");
  previous.commit();
  const set = storage.setItem;
  storage.setItem = (k, v) => {
    if (k === "checkout_replacing_attempt_v1") throw Error("quota");
    set(k, v);
  };
  const cart = actions(captured);
  await expect(issue(cart)).rejects.toThrow("quota");
  expect(cart.captureForCheckout).not.toHaveBeenCalled();
  expect(resolveCheckoutAttempt("A").key).toBe(previous.key);
});

it.each(["financial", "guest"])(
  "keeps A authoritative if the %s publication commit point fails",
  (kind) => {
    const a = resolveCheckoutAttempt("A");
    a.commit();
    storeGuestOrderAccess("A", "token-A");
    const b = resolveCheckoutAttempt("B");
    const journal =
      kind === "financial"
        ? "checkout_attempt_rollback_v1"
        : "checkout_guest_rollback_v1";
    const remove = storage.removeItem;
    storage.removeItem = (k) => {
      if (k === journal) throw Error("commit failed");
      remove(k);
    };
    expect(() =>
      kind === "financial" ? b.commit() : storeGuestOrderAccess("B", "token-B"),
    ).toThrow("commit failed");
    expect(resolveCheckoutAttempt("A").key).toBe(a.key);
    expect(readGuestOrderAccess("A")).toBe("token-A");
    expect(readGuestOrderAccess("B")).toBeNull();
    storage.removeItem = remove;
    if (kind === "financial") expect(resolveCheckoutAttempt("A").commit()).toBe(true);
    else storeGuestOrderAccess("A", "token-A");
    expect(values.has(journal)).toBe(false);
  },
);

it("does not replace a malformed legacy key when a different request arrives", () => {
  values.set(attemptKey, "broken");
  values.set(cartKey, "A");
  expect(() => resolveCheckoutAttempt("B")).toThrow();
  expect(values.get(attemptKey)).toBe("broken");
});
it("recovers an interrupted empty state before creating a new key", () => {
  values.set("checkout_attempt_rollback_v1", "null");
  values.set(attemptKey, "half-written");
  const create = jest.fn();
  storage.removeItem = () => {
    throw Error("read-only");
  };
  expect(() => resolveCheckoutAttempt("B", storage as Storage, create)).toThrow(
    "read-only",
  );
  expect(create).not.toHaveBeenCalled();
});

describe("strict original order discovery", () => {
  const saved = {
    items: [
      {
        productId: "10000000-0000-4000-8000-000000000001",
        variantId: "20000000-0000-4000-8000-000000000001",
        quantity: 1,
      },
    ],
    fulfillment: "pickup",
    pickupContact: { name: "Buyer", phone: "2025550100" },
    buyerEmail: "buyer@example.test",
    paymentMethod: "card",
    shippingAddress: null,
    billingAddress: {
      givenName: "Test",
      familyName: "Buyer",
      line1: "1 Market St",
      city: "Washington",
      state: "DC",
      postalCode: "20001",
      country: "US",
    },
    quoteFingerprint: "a".repeat(64),
  };
  const device = "30000000-0000-4000-8000-000000000001";
  const orderId = "40000000-0000-4000-8000-000000000001";
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  function issued(originalFingerprint = JSON.stringify(saved)) {
    values.set("rdk_checkout_device_session_id", device);
    const attempt = resolveCheckoutAttempt(originalFingerprint);
    attempt.commit();
    attempt.requireRecovery("buyer");
    return attempt;
  }
  it.each([
    "foreign owner",
    "changed pair",
    "changed device",
    "malformed",
    "oversized",
    "unexpected field",
  ])("refuses %s before any prepare", async (kind) => {
    issued(
      kind === "malformed"
        ? "{"
        : kind === "oversized"
          ? "a".repeat(33000)
          : kind === "unexpected field"
            ? JSON.stringify({ ...saved, unrecognized: true })
            : undefined,
    );
    if (kind === "changed pair") values.set(cartKey, "replaced");
    if (kind === "changed device") values.set("rdk_checkout_device_session_id", orderId);
    global.fetch = jest.fn();
    await expect(
      recoverOriginalOrder(
        kind === "foreign owner" ? "other" : "buyer",
        jest.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each(["owner", "pair", "device", "unmount"])(
    "a delayed discovery response cannot publish after %s replacement",
    async (kind) => {
      const attempt = issued();
      const lifetime = new AbortController();
      let read!: () => void, complete!: (data: unknown) => void;
      const reading = new Promise<void>((r) => (read = r));
      const body = new Promise((r) => (complete = r));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => {
          read();
          return body;
        },
      });
      const owner = jest.fn().mockResolvedValue(undefined);
      const pending = recoverOriginalOrder("buyer", owner, lifetime.signal);
      await reading;
      if (kind === "owner") owner.mockRejectedValueOnce(Error("access changed"));
      if (kind === "pair") values.set(attemptKey, orderId);
      if (kind === "device") values.set("rdk_checkout_device_session_id", orderId);
      if (kind === "unmount") lifetime.abort();
      complete({ code: "CHECKOUT_RECOVERY_REQUIRED", orderId });
      await expect(pending).rejects.toThrow();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(values.get(attemptKey)).toBe(kind === "pair" ? orderId : attempt.key);
      expect(JSON.parse(values.get("checkout_original_recovery_v1")!)).not.toHaveProperty(
        "orderId",
      );
    },
  );
});

it.each(["different_context", "retired_capture"] as const)(
  "restricts a %s capture to discovery of its original account/device pair",
  async (reason) => {
    const device = "62222222-2222-4222-8222-222222222222";
    values.set("rdk_checkout_device_session_id", device);
    const run = (cart: CartPurchaseActions, ownerId: string, view = () => true) =>
      capturePreparedAttempt(
        cart,
        lines,
        fingerprint,
        new AbortController().signal,
        jest.fn(),
        view,
        ownerId,
      );
    const issued = await run(actions(captured), "buyer");
    const stale = actions({ status: "stale", reason });
    await expect(run(stale, "other")).rejects.toThrow("checkout changed");
    await expect(run(stale, "buyer", () => false)).rejects.toThrow("checkout changed");
    values.set("rdk_checkout_device_session_id", "72222222-2222-4222-8222-222222222222");
    await expect(run(stale, "buyer")).rejects.toThrow("checkout changed");
    values.set("rdk_checkout_device_session_id", device);
    const stamp = values.get("checkout_issued_context_v1")!;
    values.delete("checkout_issued_context_v1");
    await expect(run(stale, "buyer")).rejects.toThrow("checkout changed");
    values.set("checkout_issued_context_v1", stamp);
    const original = await run(stale, "buyer");
    expect(original).toMatchObject({
      key: issued.key,
      recoveryOnly: true,
      discoverOriginal: true,
    });
    expect(stale.bindPreparedOrder).not.toHaveBeenCalled();
    expect(values.get(attemptKey)).toBe(issued.key);
  },
);

it("never mints a replacement device for the issued pair; a superseded marker cannot strand a different pair", async () => {
  const device = "62222222-2222-4222-8222-222222222222";
  values.set("rdk_checkout_device_session_id", device);
  const issued = await capturePreparedAttempt(
    actions(captured),
    lines,
    fingerprint,
    new AbortController().signal,
    jest.fn(),
    () => true,
    "buyer",
  );
  values.delete("rdk_checkout_device_session_id");
  const create = jest.fn(() => "new-device");
  expect(() => getOrCreateCheckoutDeviceSessionId(storage as Storage, create)).toThrow(
    "original checkout device",
  );
  expect(create).not.toHaveBeenCalled();
  expect(values.get(attemptKey)).toBe(issued.key);
  values.set(attemptKey, legacyKey);
  expect(getOrCreateCheckoutDeviceSessionId(storage as Storage, create)).toBe(
    "new-device",
  );
  expect(create).toHaveBeenCalledTimes(1);
});
