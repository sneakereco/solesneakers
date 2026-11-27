import { readPurchasedLines } from "../../../Source/Features/OrderStatus/purchased-lines";
type Client = Parameters<typeof readPurchasedLines>[1];
const id = "10000000-0000-4000-8000-000000000001";
const row = {
  id,
  order_id: id,
  product_id: "20000000-0000-4000-8000-000000000001",
  variant_id: "30000000-0000-4000-8000-000000000001",
  quantity: 2,
};
const authorizedAccess = { orderId: id, status: "paid", financialReview: false };
function reader(data: unknown, count: number) {
  const eq = jest.fn().mockResolvedValue({ data, count, error: null });
  return { from: jest.fn(() => ({ select: () => ({ eq }) })) };
}
it("reads an exact authorized settled projection", async () => {
  const client = reader([row], 1);
  expect(
    await readPurchasedLines(
      { orderId: id, authorizedAccess },
      client as unknown as Client,
    ),
  ).toEqual([{ productId: row.product_id, variantId: row.variant_id, quantity: 2 }]);
});
it.each([
  [[], 1],
  [[row], 2],
  [[row, row], 2],
  [[{ ...row, quantity: 0 }], 1],
  [[{ ...row, order_id: row.product_id }], 1],
  [[{ ...row, product_id: "malformed" }], 1],
] as const)("refuses incomplete or malformed rows %#", async (data, count) => {
  const client = reader(data, count);
  expect(
    await readPurchasedLines(
      { orderId: id, authorizedAccess },
      client as unknown as Client,
    ),
  ).toBeNull();
});
it.each([
  null,
  { ...authorizedAccess, orderId: row.product_id },
  { ...authorizedAccess, status: "refunded" },
  { ...authorizedAccess, financialReview: true },
])(
  "never reads lines without matching access and eligible settlement",
  async (access) => {
    const client = reader([row], 1);
    expect(
      await readPurchasedLines(
        { orderId: id, authorizedAccess: access },
        client as unknown as Client,
      ),
    ).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  },
);
