import { CartService } from "@/services/cart-service";
import type { OrderStatusResponse } from "@/types/domain/checkout";

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: jest.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: (key: string) => entries.delete(key),
  };
}
const row = {
  productId: "p",
  variantId: "v",
  name: "Shoes",
  brand: "Brand",
  sizeLabel: "10",
  titleDisplay: "Shoes",
  priceCents: 20,
  imageUrl: "/x",
};
const purchase = { productId: "p", variantId: "v", quantity: 2 };
const paid = {
  id: "order",
  status: "paid",
  customerId: null,
  purchasedItems: [purchase],
} as OrderStatusResponse;
const key = "rdk_cart_session";
let session: ReturnType<typeof storage>;
let account: ReturnType<typeof storage>;
let cart: CartService;

beforeEach(() => {
  session = storage();
  account = storage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      sessionStorage: session,
      localStorage: account,
    }),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: session,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: account,
  });
  Object.defineProperty(globalThis.navigator, "locks", {
    configurable: true,
    value: {
      request: (_key: string, operation: () => unknown) => Promise.resolve(operation()),
    },
  });
  cart = new CartService(null);
});

async function bindTwo() {
  await cart.addItem(row);
  await cart.addItem(row);
  const snapshot = cart.captureCheckoutSnapshot(cart.read().revision);
  expect(await cart.bindCheckoutSnapshot("order", snapshot)).toBe(true);
}

test("a failed local save cannot announce a successful addition", async () => {
  session.setItem.mockImplementation(() => {
    throw Error("Quota");
  });
  expect(await cart.addItem(row)).toBe(false);
  expect(cart.getCart()).toEqual([]);
});
test("decrease then increase, bounded consumption, failed persistence and replay", async () => {
  await bindTwo();
  await cart.updateQuantity("p", "v", 1);
  await cart.addItem(row);
  const raw = session.getItem(key);
  session.setItem.mockImplementationOnce(() => {
    throw Error("Denied");
  });
  expect(await cart.consumeConfirmedOrder(paid)).toBe(false);
  expect(session.getItem(key)).toBe(raw);
  const reloaded = new CartService(null);
  expect(await reloaded.consumeConfirmedOrder(paid)).toBe(true);
  expect(reloaded.getCart()[0].quantity).toBe(1);
  await reloaded.consumeConfirmedOrder(paid);
  expect(reloaded.getCart()[0].quantity).toBe(1);
});
test("only the purchased prefix of the captured units can ever be consumed", async () => {
  await bindTwo();
  await cart.addItem(row);
  const other = { ...row, variantId: "other" };
  await cart.addItem(other);
  const receipt = { ...paid, purchasedItems: [{ ...purchase, quantity: 1 }] };
  await cart.consumeConfirmedOrder(receipt);
  await new CartService().consumeConfirmedOrder(receipt);
  expect(cart.getCart().map((x) => x.quantity)).toEqual([2, 1]);
});
test("remove and re-add, and mismatched or unbound identities preserve the basket", async () => {
  await bindTwo();
  const raw = session.getItem(key);
  for (const order of [
    { ...paid, customerId: "account" },
    { ...paid, id: "old" },
    { ...paid, customerId: undefined },
    { ...paid, purchasedItems: undefined },
    ...["pending", "failed", "review"].map((status) => ({ ...paid, status })),
  ]) {
    expect(await cart.consumeConfirmedOrder(order)).toBe(false);
    expect(session.getItem(key)).toBe(raw);
  }
  await cart.removeItem("p", "v");
  await cart.addItem(row);
  await cart.consumeConfirmedOrder(paid);
  expect(cart.getCart()[0].quantity).toBe(1);
});
test.each(["edit", "clear"])(
  "undelivered legacy %s writes retire even preserved metadata before a new reader consumes",
  async (action) => {
    await bindTwo();
    const old = JSON.parse(session.getItem(key)!);
    if (action === "clear") session.setItem(key, "[]");
    else session.setItem(key, JSON.stringify([{ ...old[0], quantity: 1 }]));
    session.setItem(key, JSON.stringify(old));
    const reload = new CartService();
    await reload.hydrate();
    await reload.consumeConfirmedOrder(paid);
    expect(reload.getCart()[0].quantity).toBe(2);
  },
);
test("migration preserves the account array and never imports it into the guest", async () => {
  account.setItem("rdk_cart", JSON.stringify([{ ...row, quantity: 2 }]));
  await cart.hydrate();
  expect(cart.getCart()).toEqual([]);
  const buyer = new CartService("buyer");
  await buyer.hydrate();
  expect(buyer.getCart()[0].quantity).toBe(2);
  expect(Array.isArray(JSON.parse(account.getItem("rdk_cart_user_buyer")!))).toBe(true);
});
test("account writes fail conservatively when coordination is denied", async () => {
  Object.defineProperty(navigator, "locks", {
    value: { request: () => Promise.reject(Error("Denied")) },
  });
  expect(await new CartService("buyer").addItem(row)).toBe(false);
  expect(account.getItem("rdk_cart_user_buyer")).toBeNull();
});
test("denied storage preserves remove, update, set and clear and blocks unpersisted order bindings", async () => {
  await bindTwo();
  const saved = session.getItem(key);
  session.setItem.mockImplementation(() => {
    throw Error("Denied");
  });
  expect(await cart.updateQuantity("p", "v", 1)).toBe(false);
  expect(await cart.removeItem("p", "v")).toBe(false);
  expect(await cart.setCart([])).toBe(false);
  expect(await cart.clearCart()).toBe(false);
  expect(
    await cart.bindCheckoutSnapshot("other", cart.captureCheckoutSnapshot(saved)),
  ).toBe(false);
  expect(session.getItem(key)).toBe(saved);
});
test("stale rendered captures and obsolete absolute quantity updates fail conservatively", async () => {
  await bindTwo();
  const before = cart.read().revision;
  await cart.addItem(row);
  expect(() => cart.captureCheckoutSnapshot(before)).toThrow("Your cart changed");
  expect(await cart.updateQuantity("p", "v", 1, () => true, before)).toBe(false);
  expect(cart.getCart()[0].quantity).toBe(3);
});
test("a reduced stock cap trims existing units without reporting a successful addition", async () => {
  await bindTwo();
  expect(await cart.addItem({ ...row, maxStock: 1 })).toBe(false);
  expect(cart.getCart()).toMatchObject([{ quantity: 1, maxStock: 1 }]);
});

test("receipt reports only a failed save of matched units and can retry without consuming later additions", async () => {
  await bindTwo();
  const onSaveFailure = jest.fn();
  for (const order of [
    { ...paid, id: "unbound" },
    { ...paid, purchasedItems: undefined },
  ]) {
    expect(await cart.consumeConfirmedOrder(order, () => true, onSaveFailure)).toBe(
      false,
    );
  }
  expect(onSaveFailure).not.toHaveBeenCalled();
  session.setItem.mockImplementationOnce(() => {
    throw Error("Quota");
  });
  expect(await cart.consumeConfirmedOrder(paid, () => true, onSaveFailure)).toBe(false);
  expect(onSaveFailure).toHaveBeenCalledTimes(1);
  expect(cart.getCart()[0].quantity).toBe(2);
  await cart.addItem(row);
  expect(await cart.consumeConfirmedOrder(paid, () => true, onSaveFailure)).toBe(true);
  expect(await cart.consumeConfirmedOrder(paid, () => true, onSaveFailure)).toBe(false);
  expect(onSaveFailure).toHaveBeenCalledTimes(1);
  expect(cart.getCart()[0].quantity).toBe(1);
});

test.each(["binding", "primary", "lock"])(
  "reports a confirmed owner's unavailable %s and retries without changing the paid order",
  async (denial) => {
    const buyer = new CartService("buyer");
    expect(await buyer.hydrate()).toBe(true);
    await buyer.addItem(row);
    expect(
      await buyer.bindCheckoutSnapshot(
        "order",
        buyer.captureCheckoutSnapshot(buyer.read().revision),
      ),
    ).toBe(true);
    const originalRead = account.getItem;
    const originalLocks = navigator.locks;
    const onUnavailable = jest.fn();
    try {
      if (denial === "lock")
        Object.defineProperty(navigator, "locks", {
          value: { request: () => Promise.reject(Error("Denied")) },
        });
      else
        account.getItem = (storageKey: string) => {
          if ((denial === "primary") === (storageKey === buyer.key))
            throw Error("Unavailable");
          return originalRead(storageKey);
        };
      const order = { ...paid, customerId: "buyer" };
      expect(
        await buyer.consumeConfirmedOrder(
          { ...order, purchasedItems: undefined },
          () => true,
          onUnavailable,
        ),
      ).toBe(false);
      expect(onUnavailable).not.toHaveBeenCalled();
      expect(await buyer.consumeConfirmedOrder(order, () => true, onUnavailable)).toBe(
        false,
      );
      expect(onUnavailable).toHaveBeenCalledTimes(1);
    } finally {
      account.getItem = originalRead;
      Object.defineProperty(navigator, "locks", { value: originalLocks });
    }
    expect(buyer.getCart()[0].quantity).toBe(1);
    expect(
      await buyer.consumeConfirmedOrder(
        { ...paid, customerId: "buyer" },
        () => true,
        onUnavailable,
      ),
    ).toBe(true);
    expect(buyer.getCart()).toEqual([]);
  },
);
