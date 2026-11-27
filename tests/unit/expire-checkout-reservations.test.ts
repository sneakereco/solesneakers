import {
  expireCheckout,
  type ExpiryMark,
} from "@/Modules/Checkout/Source/Features/Recovery/expiry-operation";
const dependencies = (mark: ExpiryMark) => ({
  mark: jest.fn(() => Promise.resolve(mark)),
  inquire: jest.fn(async () => {}),
  cancelOrder: jest.fn(() => Promise.resolve("sq")),
  cancelByKey: jest.fn(async () => {}),
  finish: jest.fn(() => Promise.resolve("released" as const)),
});
it.each(["review", "unchanged"] as const)(
  "leaves %s decisions untouched",
  async (kind) => {
    const deps = dependencies({ kind });
    expect(await expireCheckout("order", deps)).toBe(kind);
    expect(deps.cancelOrder).not.toHaveBeenCalled();
    expect(deps.finish).not.toHaveBeenCalled();
  },
);
it("only offers the independently confirmed order to the locked release", async () => {
  const deps = dependencies({ kind: "inquire", squareOrderId: "sq", unknownKeys: [] });
  expect(await expireCheckout("order", deps)).toBe("released");
  expect(deps.inquire).toHaveBeenCalledWith("order");
  expect(deps.cancelOrder).toHaveBeenCalledWith("sq", "order");
  expect(deps.finish).toHaveBeenCalledWith("order", "sq");
});
it.each(["inquire", "cancelOrder"] as const)(
  "retains stock on failed %s",
  async (method) => {
    const deps = dependencies({ kind: "inquire", squareOrderId: "sq", unknownKeys: [] });
    deps[method].mockRejectedValue(Error("unavailable"));
    await expect(expireCheckout("order", deps)).rejects.toThrow();
    expect(deps.finish).not.toHaveBeenCalled();
  },
);
it("submits unattached guarded orders to the final DB proof check", async () => {
  const deps = dependencies({ kind: "inquire", squareOrderId: null, unknownKeys: [] });
  await expireCheckout("order", deps);
  expect(deps.inquire).not.toHaveBeenCalled();
  expect(deps.finish).toHaveBeenCalledWith("order", null);
});
