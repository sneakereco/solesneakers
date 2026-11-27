import { OrdersService } from "@/services/orders-service";
import { OrdersRepository } from "@/repositories/orders-repo";
import { OrderEventsRepository } from "@/repositories/order-events-repo";
import { OrderAccessTokenService } from "@/services/order-access-token-service";
jest.mock("@/lib/utils/log");
jest.mock("@/services/order-access-token-service");
jest.mock("@/repositories/order-events-repo");
const orderId = crypto.randomUUID(),
  product = crypto.randomUUID(),
  variant = crypto.randomUUID();
const rows = [
  {
    id: crypto.randomUUID(),
    order_id: orderId,
    product_id: product,
    variant_id: variant,
    quantity: 2,
  },
];

function db(owner: string | null, allowed: boolean, itemReadError = false) {
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    let columns = "";
    const chain = {
      select: (fields: string) => {
        columns = fields;
        return chain;
      },
      eq: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: allowed
            ? {
                id: orderId,
                user_id: owner,
                status: "paid",
                tenant_id: "tenant",
                currency: "USD",
                checkout_attempt_guarded: false,
                checkout_financial_review: null,
                refund_amount: null,
                fulfillment_status: "unfulfilled",
                subtotal: 10,
                total: 10,
                tax_amount: 0,
                shipping: 0,
                fulfillment: "pickup",
                ...(columns.includes("checkout_financial_facts")
                  ? {
                      facts: [],
                      attempts: [],
                      refunds: [],
                      factCount: [{ count: 0 }],
                      attemptCount: [{ count: 0 }],
                      refundCount: [{ count: 0 }],
                    }
                  : {}),
              }
            : null,
        }),
      then: (resolve: (v: unknown) => unknown) =>
        resolve({
          data: rows,
          count: rows.length,
          error: itemReadError ? Error("unavailable") : null,
        }),
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
      admin = db(mode === "owner" ? "buyer" : null, true);
    jest
      .mocked(OrderAccessTokenService.prototype.verifyToken)
      .mockResolvedValue({ order_id: orderId } as never);
    const result = await new OrdersService(session.client, admin.client).getOrderStatus(
      orderId,
      mode === "owner" ? "buyer" : null,
      mode === "token" ? "valid" : null,
    );
    expect(result).toMatchObject({
      customerId: mode === "owner" ? "buyer" : null,
      purchasedItems: [{ productId: product, variantId: variant, quantity: 2 }],
    });
    expect(result.purchasedItems).toEqual(result.purchasedLines);
    expect(mode === "owner" ? session.reads : admin.reads).toContain("order_items");
  },
);
test("a denied owner and invalid token never query purchased items", async () => {
  const session = db(null, false),
    admin = db(null, false);
  await expect(
    new OrdersService(session.client, admin.client).getOrderStatus(
      orderId,
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
    new OrdersRepository(client as never).listPurchasedItems(orderId),
  ).rejects.toThrow("unavailable");
});
test("a receipt still reports its confirmed payment when optional purchased items are unavailable", async () => {
  const session = db("buyer", true, true);
  const admin = db("buyer", true);
  const result = await new OrdersService(session.client, admin.client).getOrderStatus(
    orderId,
    "buyer",
    null,
  );
  expect(result.status).toBe("paid");
  expect(result.purchasedItems).toBeUndefined();
  expect(result.purchasedLines).toBeNull();
});
