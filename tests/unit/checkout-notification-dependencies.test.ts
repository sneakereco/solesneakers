import { createCheckoutNotificationDependencies } from "@/lib/checkout/checkout-notification-dependencies";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { OrderEmailService } from "@/services/order-email-service";

jest.mock("@/services/order-email-service");
jest.mock("@/services/order-access-token-service");
jest.mock("@/services/refund-notification-service");
jest.mock("@/repositories/order-events-repo");

beforeEach(() => jest.clearAllMocks());

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

it("sends pickup instructions as their own notification", async () => {
  const auditQuery = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  const orderQuery = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: {
        id: "order-1",
        user_id: "user-1",
        tenant_id: "tenant-1",
        fulfillment: "pickup",
        profiles: { email: "buyer@example.com" },
      },
      error: null,
    }),
  };
  const admin = {
    from: (table: string) => (table === "email_audit_log" ? auditQuery : orderQuery),
  } as unknown as AdminSupabaseClient;

  await createCheckoutNotificationDependencies(admin).send({
    id: "notification-2",
    orderId: "order-1",
    kind: "pickup_instructions",
    payload: {},
  });

  expect(OrderEmailService).toHaveBeenCalledWith(admin, "tenant-1", "notification-2");
  expect(OrderEmailService.prototype.sendPickupInstructions).toHaveBeenCalledWith({
    to: "buyer@example.com",
    orderId: "order-1",
    orderUrl: null,
  });
  expect(
    OrderEmailService.prototype.sendOrderConfirmationFromDetailed,
  ).not.toHaveBeenCalled();
});

it("does not resend an accepted order confirmation after queue completion failed", async () => {
  const auditQuery = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: { id: "sent-audit" }, error: null }),
  };
  const admin = { from: () => auditQuery } as unknown as AdminSupabaseClient;

  await createCheckoutNotificationDependencies(admin).send({
    id: "notification-1",
    orderId: "order-1",
    kind: "order_confirmation",
    payload: {},
  });

  expect(
    OrderEmailService.prototype.sendOrderConfirmationFromDetailed,
  ).not.toHaveBeenCalled();
});

it("claims only notifications for the requested paid order", async () => {
  const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
  const admin = { rpc } as unknown as AdminSupabaseClient;

  await createCheckoutNotificationDependencies(admin, "order-1").claim(2);

  expect(rpc).toHaveBeenCalledWith("claim_checkout_notifications_for_order", {
    p_limit: 2,
    p_order_id: "order-1",
  });
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
        fulfillment: "ship",
        currency: "USD",
        subtotal: 100,
        tax_amount: 8,
        shipping: 12,
        total: 120,
        profiles: { email: "buyer@example.com" },
        items,
        shippingAddress: [{ name: "Buyer", line1: "1 Main St" }],
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
    from: jest.fn((table: string) => (table === "email_audit_log" ? auditQuery : query)),
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
  expect(selection).toContain("shippingAddress:order_shipping(*)");
  expect(OrderEmailService).toHaveBeenCalledWith(admin, "tenant-1", "notification-1");
  expect(
    OrderEmailService.prototype.sendOrderConfirmationFromDetailed,
  ).toHaveBeenCalledWith(
    expect.objectContaining({
      itemsDetailed: items,
      order: expect.objectContaining({
        shipping: 12,
        shippingAddress: expect.objectContaining({ line1: "1 Main St" }),
      }),
    }),
  );
});
