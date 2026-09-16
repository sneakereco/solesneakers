import {
  readConfirmedOrder,
  storeConfirmedOrder,
} from "@/lib/checkout/confirmed-order-cache";

const paidOrder = {
  id: "order-1",
  status: "paid",
  subtotal: 100,
  shipping: 0,
  tax: 8,
  total: 108,
  fulfillment: "pickup" as const,
  updatedAt: "2026-09-16T00:00:00.000Z",
  events: [],
  supportEmail: "support@example.com",
};

describe("confirmed order cache", () => {
  let values: Map<string, string>;
  let storage: Storage;
  beforeEach(() => {
    values = new Map();
    storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => void values.delete(key),
      setItem: (key, value) => void values.set(key, value),
    };
  });

  it("returns a matching paid order once", () => {
    storeConfirmedOrder(paidOrder, storage);

    expect(readConfirmedOrder("order-1", storage)).toEqual(paidOrder);
    expect(readConfirmedOrder("order-1", storage)).toBeNull();
  });

  it.each([
    { ...paidOrder, id: "another-order" },
    { ...paidOrder, status: "pending" },
    { ...paidOrder, total: "108" },
  ])("rejects data that cannot prove this order is paid", (value) => {
    storage.setItem("checkout:confirmed:order-1", JSON.stringify(value));

    expect(readConfirmedOrder("order-1", storage)).toBeNull();
  });

  it("never blocks confirmation when browser storage is unavailable", () => {
    const unavailable = {
      ...storage,
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(() => storeConfirmedOrder(paidOrder, unavailable)).not.toThrow();
    expect(readConfirmedOrder("order-1", unavailable)).toBeNull();
  });
});
