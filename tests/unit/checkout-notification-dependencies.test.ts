import { createCheckoutNotificationDependencies } from "@/lib/checkout/checkout-notification-dependencies";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { OrderEmailService } from "@/services/order-email-service";

jest.mock("@/services/order-email-service");
jest.mock("@/services/order-access-token-service");
jest.mock("@/services/refund-notification-service");
jest.mock("@/repositories/order-events-repo");

it.each(["shipping_update", "delivery_confirmation"] as const)(
  "sends queued %s from the persisted carrier payload",
  async (kind) => {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: "order-1",
          user_id: "user-1",
          tenant_id: "tenant-1",
          fulfillment_status: "shipped",
          profiles: { email: "buyer@example.com" },
        },
        error: null,
      }),
    };
    const auditQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const admin = {
      from: (table: string) => (table === "email_audit_log" ? auditQuery : query),
    } as unknown as AdminSupabaseClient;
    await createCheckoutNotificationDependencies(admin).send({
      id: "notification-1",
      orderId: "order-1",
      kind,
      payload: { trackingNumber: "tracking-1", carrier: "usps", trackingUrl: null },
    });
    const send =
      kind === "shipping_update"
        ? OrderEmailService.prototype.sendOrderInTransit
        : OrderEmailService.prototype.sendOrderDelivered;
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        trackingNumber: "tracking-1",
        carrier: "usps",
      }),
    );
  },
);

it("does not resend an accepted shipping email after queue completion failed", async () => {
  jest.clearAllMocks();
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: { id: "sent-audit" }, error: null }),
  };
  const admin = { from: () => query } as unknown as AdminSupabaseClient;
  await createCheckoutNotificationDependencies(admin).send({
    id: "notification-1",
    orderId: "order-1",
    kind: "delivery_confirmation",
    payload: { trackingNumber: "tracking-1", carrier: null, trackingUrl: null },
  });
  expect(OrderEmailService.prototype.sendOrderDelivered).not.toHaveBeenCalled();
});

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
