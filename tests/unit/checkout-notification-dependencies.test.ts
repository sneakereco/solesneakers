import { createCheckoutNotificationDependencies } from "@/lib/checkout/checkout-notification-dependencies";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { OrderEmailService } from "@/services/order-email-service";

jest.mock("@/services/order-email-service");
jest.mock("@/services/order-access-token-service");
jest.mock("@/services/refund-notification-service");
jest.mock("@/repositories/order-events-repo");

it("loads supported product columns and preserves purchased brand/model snapshots", async () => {
  const items = [
    { product_name: "Shoe", brand: "Purchased brand", model: "Purchased model" },
  ];
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: {
        id: "order-1",
        user_id: "user-1",
        tenant_id: "tenant-1",
        profiles: { email: "buyer@example.com" },
        items,
      },
      error: null,
    }),
  };
  const admin = {
    from: jest.fn().mockReturnValue(query),
  } as unknown as AdminSupabaseClient;
  await createCheckoutNotificationDependencies(admin).send({
    id: "notification-1",
    orderId: "order-1",
    kind: "order_confirmation",
    payload: {},
  });
  const selection = query.select.mock.calls[0][0] as string;
  expect(selection).toContain("product_name, brand, model");
  expect(selection).toContain("product:products(name, category, images:");
  expect(
    OrderEmailService.prototype.sendOrderConfirmationFromDetailed,
  ).toHaveBeenCalledWith(expect.objectContaining({ itemsDetailed: items }));
});
