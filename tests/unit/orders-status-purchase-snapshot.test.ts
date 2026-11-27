import { OrdersService } from "@/services/orders-service";
import { OrdersRepository } from "@/repositories/orders-repo";
import { OrderEventsRepository } from "@/repositories/order-events-repo";
import { OrderAccessTokenService } from "@/services/order-access-token-service";
jest.mock("@/lib/utils/log");
jest.mock("@/services/order-access-token-service");
jest.mock("@/repositories/order-events-repo");
const rows = [{ product_id: "p", variant_id: "v", quantity: 2 }];

function db(owner: string | null, allowed: boolean) {
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: allowed ? { id: "order", user_id: owner, status: "paid" } : null,
        }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return chain;
  };
  return { client: { from } as never, reads };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(OrderEventsRepository.prototype.listByOrderId).mockResolvedValue([]);
});
test.each(["owner", "token"])(
  "returns authoritative purchased rows after %s authorization",
  async (mode) => {
    const session = db("buyer", mode === "owner"),
      admin = db(null, true);
    jest
      .mocked(OrderAccessTokenService.prototype.verifyToken)
      .mockResolvedValue({ order_id: "order" } as never);
    const result = await new OrdersService(session.client, admin.client).getOrderStatus(
      "order",
      mode === "owner" ? "buyer" : null,
      mode === "token" ? "valid" : null,
    );
    expect(result).toMatchObject({
      customerId: mode === "owner" ? "buyer" : null,
      purchasedItems: [{ productId: "p", variantId: "v", quantity: 2 }],
    });
    expect(mode === "owner" ? session.reads : admin.reads).toEqual([
      "orders",
      "order_items",
    ]);
  },
);
test("a denied owner and invalid token never query purchased items", async () => {
  const session = db(null, false),
    admin = db(null, false);
  await expect(
    new OrdersService(session.client, admin.client).getOrderStatus(
      "order",
      "other",
      "invalid",
    ),
  ).rejects.toThrow("Unauthorized");
  expect([...session.reads, ...admin.reads]).not.toContain("order_items");
});
test("preserves server failure when a purchased-items query fails", async () => {
  const client = {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ error: Error("unavailable") }) }),
    }),
  };
  await expect(
    new OrdersRepository(client as never).listPurchasedItems("order"),
  ).rejects.toThrow("unavailable");
});
test("a receipt still reports its confirmed payment when optional purchased items are unavailable", async () => {
  const session = db("buyer", true);
  const unavailable = jest
    .spyOn(OrdersRepository.prototype, "listPurchasedItems")
    .mockRejectedValueOnce(Error("unavailable"));
  try {
    const result = await new OrdersService(session.client).getOrderStatus(
      "order",
      "buyer",
      null,
    );
    expect(result.status).toBe("paid");
    expect(result.purchasedItems).toBeUndefined();
  } finally {
    unavailable.mockRestore();
  }
});
