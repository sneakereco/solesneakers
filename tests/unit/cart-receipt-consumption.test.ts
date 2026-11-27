import {
  BasketStorage,
  type BasketView,
} from "@/Modules/Cart/Source/Features/ManageBasket/cart-storage";

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => entries.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: (key: string) => entries.delete(key),
  };
}
const row = {
  productId: crypto.randomUUID(),
  variantId: crypto.randomUUID(),
  name: "Shoes",
  brand: "Brand",
  sizeLabel: "10",
  titleDisplay: "Shoes",
  priceCents: 20,
  imageUrl: "/x",
};
const order = crypto.randomUUID();
const item = { productId: row.productId, variantId: row.variantId, quantity: 2 };
const key = "rdk_cart_session";
let session: ReturnType<typeof storage>, account: ReturnType<typeof storage>;
let cleanups: Array<() => void>;
const locks = {
  request: (_name: string, _options: unknown, fn: () => unknown) => Promise.resolve(fn()),
};
async function connect(owner: string | null = null) {
  const basket = new BasketStorage(owner, () => true, {});
  let view!: BasketView;
  let loaded!: () => void;
  const ready = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  cleanups.push(
    basket.connect((next) => {
      view = next;
      loaded();
    }),
  );
  await ready;
  return {
    basket,
    get view() {
      return view;
    },
  };
}
async function bindTwo(owner: string | null = null) {
  const cart = await connect(owner);
  expect((await cart.basket.addItem(row)).status).toBe("saved");
  expect((await cart.basket.addItem(row)).status).toBe("saved");
  const capture = await cart.view.purchases.captureForCheckout({
    mode: "new",
    attemptKey: crypto.randomUUID(),
    expectedItems: [item],
  });
  if (capture.status !== "captured") throw Error("Expected captured original units");
  expect(await cart.view.purchases.bindPreparedOrder(capture.captureId, order)).toBe(
    true,
  );
  return cart;
}
beforeEach(() => {
  session = storage();
  account = storage();
  cleanups = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      name: "",
      sessionStorage: session,
      localStorage: account,
    }),
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
  jest.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}, { status: 503 }));
});
afterEach(() => {
  for (const close of cleanups.reverse()) close();
  jest.restoreAllMocks();
});

test("a refused lower-cap addition preserves requested units for the shopper to adjust", async () => {
  const cart = await bindTwo();
  expect((await cart.basket.addItem({ ...row, maxStock: 1 })).status).not.toBe("saved");
  expect(cart.view.items[0].quantity).toBe(2);
  expect((await cart.basket.updateQuantity(row.productId, row.variantId, 1)).status).toBe(
    "saved",
  );
  expect(cart.view.items[0].quantity).toBe(1);
});
test("declined writes preserve saved bytes and report no success", async () => {
  const cart = await bindTwo();
  const original = session.getItem(key);
  session.setItem.mockImplementation(() => {
    throw Error("Quota");
  });
  expect((await cart.basket.addItem(row)).status).not.toBe("saved");
  expect(
    (await cart.basket.updateQuantity(row.productId, row.variantId, 1)).status,
  ).not.toBe("saved");
  expect((await cart.basket.removeItem(row.productId, row.variantId)).status).not.toBe(
    "saved",
  );
  expect((await cart.basket.setItems([])).status).not.toBe("saved");
  expect(session.getItem(key)).toBe(original);
});
test("a failed receipt write and a retry consume only surviving original units", async () => {
  const cart = await bindTwo();
  await cart.basket.updateQuantity(row.productId, row.variantId, 1);
  await cart.basket.addItem(row);
  const original = session.getItem(key);
  session.setItem.mockImplementationOnce(() => {
    throw Error("Denied");
  });
  expect(
    (await cart.view.purchases.consumeConfirmedPurchase(order, [item])).status,
  ).not.toBe("matched");
  expect(session.getItem(key)).toBe(original);
  const reload = await connect();
  expect(
    (await reload.view.purchases.consumeConfirmedPurchase(order, [item])).status,
  ).toBe("matched");
  expect(reload.view.items[0].quantity).toBe(1);
  const written = session.setItem.mock.calls.length;
  expect(
    (await reload.view.purchases.consumeConfirmedPurchase(order, [item])).status,
  ).toBe("matched");
  expect(session.setItem).toHaveBeenCalledTimes(written);
});
test("partial receipt cannot consume later additions or unrelated variants on replay", async () => {
  const cart = await bindTwo();
  await cart.basket.addItem(row);
  await cart.basket.addItem({ ...row, variantId: crypto.randomUUID() });
  const partial = [{ ...item, quantity: 1 }];
  expect(
    (await cart.view.purchases.consumeConfirmedPurchase(order, partial)).status,
  ).toBe("matched");
  const reload = await connect();
  expect(
    (await reload.view.purchases.consumeConfirmedPurchase(order, partial)).status,
  ).toBe("matched");
  expect(reload.view.items.map((i) => i.quantity)).toEqual([2, 1]);
});
test("unbound, foreign, or stale observations cannot consume the basket", async () => {
  const cart = await bindTwo();
  const original = session.getItem(key);
  expect(
    (await cart.view.purchases.consumeConfirmedPurchase(crypto.randomUUID(), [item]))
      .status,
  ).not.toBe("matched");
  expect(
    (
      await cart.view.purchases.consumeConfirmedPurchase(
        order,
        [item],
        undefined,
        () => false,
      )
    ).status,
  ).not.toBe("matched");
  const buyer = await connect("buyer");
  expect(
    (await buyer.view.purchases.consumeConfirmedPurchase(order, [item])).status,
  ).not.toBe("matched");
  expect(session.getItem(key)).toBe(original);
  await cart.basket.removeItem(row.productId, row.variantId);
  await cart.basket.addItem(row);
  await cart.view.purchases.consumeConfirmedPurchase(order, [item]);
  expect(cart.view.items[0].quantity).toBe(1);
});
test.each(["edit", "clear"])(
  "a legacy %s replacement with untracked units never proves a purchased basket",
  async (action) => {
    await bindTwo();
    session.setItem(
      key,
      JSON.stringify(action === "clear" ? [] : [{ ...row, quantity: 1 }]),
    );
    session.setItem(
      key,
      JSON.stringify([
        { ...row, quantity: 2, unitsV1: [{ id: "older", start: 0, end: 2 }] },
      ]),
    );
    const reload = await connect();
    const original = session.getItem(key);
    expect(
      (await reload.view.purchases.consumeConfirmedPurchase(order, [item])).status,
    ).not.toBe("matched");
    expect(session.getItem(key)).toBe(original);
  },
);
test("account migration is isolated from guest storage", async () => {
  account.setItem("rdk_cart", JSON.stringify([{ ...row, quantity: 2 }]));
  const guest = await connect();
  expect(guest.view.items).toEqual([]);
  const buyer = await connect("buyer");
  expect(buyer.view.items[0].quantity).toBe(2);
  expect(Array.isArray(JSON.parse(account.getItem("rdk_cart_user_buyer")!))).toBe(true);
});
test("obsolete rendered capture cannot bind a changed basket", async () => {
  const cart = await bindTwo();
  const previous = cart.view;
  await cart.basket.addItem(row);
  const stale = await previous.purchases.captureForCheckout({
    mode: "new",
    attemptKey: crypto.randomUUID(),
    expectedItems: [item],
  });
  expect(stale.status).not.toBe("captured");
  expect(cart.view.items[0].quantity).toBe(3);
});
test.each(["binding", "primary", "lock"])(
  "account receipt preserves stock through denied %s reads and retries",
  async (denial) => {
    await bindTwo("buyer");
    const buyerKey = "rdk_cart_user_buyer";
    const original = account.getItem(buyerKey);
    const getter = account.getItem.getMockImplementation()!;
    if (denial === "lock")
      Object.defineProperty(navigator, "locks", {
        value: { request: () => Promise.reject(Error("Denied")) },
      });
    else
      account.getItem.mockImplementation((k) => {
        if (k === (denial === "binding" ? buyerKey + ":purchase-v1" : buyerKey))
          throw Error("Denied");
        return getter(k);
      });
    const unavailable = await connect("buyer");
    expect(
      (await unavailable.view.purchases.consumeConfirmedPurchase(order, [item])).status,
    ).not.toBe("matched");
    account.getItem.mockImplementation(getter);
    Object.defineProperty(navigator, "locks", { value: locks });
    expect(account.getItem(buyerKey)).toBe(original);
    const restored = await connect("buyer");
    expect(
      (await restored.view.purchases.consumeConfirmedPurchase(order, [item])).status,
    ).toBe("matched");
    expect(restored.view.items).toEqual([]);
  },
);
