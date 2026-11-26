import { requestValidation } from "../../../Source/Features/ValidateBasket/request-validation";

const row = {
  productId: "11111111-1111-4111-8111-111111111111",
  variantId: "22222222-2222-4222-8222-222222222222",
  quantity: 2,
  maxStock: 3,
  priceCents: 1800,
  name: "Air Runner",
  titleDisplay: "Air Runner",
  brand: "Sole",
  sizeLabel: "10",
  imageUrl: "/images/logo.png",
};
const pair = { productId: row.productId, variantId: row.variantId };
const state = {
  ...pair,
  requestedQuantity: 2,
  availableQuantity: 0,
  availability: "reserved_by_other",
  reason: "reserved_by_other",
};
const legacy = { items: [], removed: [{ ...pair, reason: "out_of_stock" }] };
const run = (reply: unknown) => {
  jest.spyOn(global, "fetch").mockResolvedValue(Response.json(reply));
  return requestValidation([row]);
};
afterEach(() => jest.restoreAllMocks());
test("retains the requested units and their reason", async () => {
  expect(await run({ ...legacy, contractVersion: 2, lineState: [state] })).toEqual([
    { ...row, maxStock: 0, availability: "reserved_by_other" },
  ]);
});
test("legacy removal is generic and a clamp preserves requested units", async () => {
  expect(await run(legacy)).toEqual([
    { ...row, maxStock: 0, availability: "unavailable" },
  ]);
  expect(
    await run({
      items: [{ ...row, quantity: 1, maxStock: 1, imageUrl: "/placeholder.png" }],
      removed: [],
    }),
  ).toEqual([{ ...row, maxStock: 1, availability: "unavailable" }]);
});
test("disagreeing V2 stock and legacy projection cannot overwrite the basket", async () => {
  expect(
    await run({
      items: [row],
      removed: [],
      contractVersion: 2,
      lineState: [{ ...state, availableQuantity: 0 }],
    }),
  ).toBeUndefined();
});
test("a catalog refresh back to the original price still requires deliberate review", async () => {
  const pending = { ...row, priceCents: 2000, previousPriceCents: 1800 };
  jest
    .spyOn(global, "fetch")
    .mockResolvedValue(Response.json({ items: [row], removed: [] }));
  expect((await requestValidation([pending]))?.[0]).toMatchObject({
    priceCents: 1800,
    previousPriceCents: 1800,
  });
});
test("one scoped checkout observation cannot be promoted to free stock by a generic refresh", async () => {
  const held = { ...row, orderScoped: true as const };
  jest
    .spyOn(global, "fetch")
    .mockResolvedValue(Response.json({ items: [row], removed: [] }));
  expect((await requestValidation([held]))?.[0].orderScoped).toBe(true);
});
test.each([
  [],
  [state, state],
  [{ ...state, variantId: row.productId }],
  [{ ...state, requestedQuantity: 1 }],
  [{ ...state, availability: "available" }],
  [{ ...state, facts: { ...row, priceCents: -5 } }],
])(
  "malformed V2 state cannot fall back to the legacy projection %#",
  async (...states) => {
    expect(
      await run({ ...legacy, contractVersion: 2, lineState: states }),
    ).toBeUndefined();
  },
);
