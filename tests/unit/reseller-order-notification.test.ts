jest.mock("@/lib/email/mailer");
jest.mock("@/config/env", () => ({
  env: { NEXT_PUBLIC_SITE_URL: "https://example.com" },
}));

import { createCheckoutNotificationDependencies } from "@/lib/checkout/checkout-notification-dependencies";
import {
  processCheckoutNotifications,
  type CheckoutNotification,
} from "@/lib/checkout/checkout-notification-worker";
import { sendEmailWithRetry } from "@/lib/email/mailer";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";

const orderId = "00000000-0000-4000-8000-000000000010";
const seller = "SolesneakersLLC@yahoo.com";

// Database and SMTP are the external boundaries; dispatch, templates, audit and
// worker completion run as production code. No real messages or accounts.
function fixture(
  kinds: CheckoutNotification["kind"][] = ["reseller_order_placed"],
  customerEmail: string | null = "buyer@example.com",
) {
  const audits: Record<string, unknown>[] = [];
  const finished: { id: string; succeeded: boolean }[] = [];
  const order = {
    id: orderId,
    tenant_id: "tenant-1",
    user_id: "buyer-1",
    created_at: "2026-11-26T18:00:00Z",
    fulfillment: "pickup",
    currency: "USD",
    subtotal: 160,
    tax_amount: 12.8,
    shipping: 7.5,
    total: 180.3,
    profiles: { email: customerEmail },
    guest_email: null,
    shippingAddress: null,
    items: [
      {
        product_name: "Jordan <Retro>",
        size_label: "10",
        quantity: 2,
        unit_price: 50,
        line_total: 100,
        product: null,
        variant: null,
      },
      {
        product_name: "Tee",
        size_label: null,
        quantity: 1,
        unit_price: 60,
        line_total: 60,
        product: null,
        variant: null,
      },
    ],
  };
  const notifications = kinds.map((kind, index) => ({
    id: `00000000-0000-4000-8000-00000000002${index}`,
    orderId,
    kind,
    payload: { to: "attacker@example.com" },
  }));
  const admin = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let inserted: Record<string, unknown> | null = null;
      let patch: Record<string, unknown> | null = null;
      const query = {
        select() {
          return query;
        },
        limit() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          if (patch) Object.assign(audits.find((row) => row[key] === value)!, patch);
          return query;
        },
        insert(row: Record<string, unknown>) {
          inserted = { ...row, id: `audit-${audits.length}` };
          if (table === "email_audit_log") audits.push(inserted);
          return query;
        },
        update(value: Record<string, unknown>) {
          patch = value;
          return query;
        },
        single() {
          return Promise.resolve({ data: inserted, error: null });
        },
        maybeSingle() {
          const data =
            table === "orders"
              ? order
              : (audits.find((row) =>
                  Object.entries(filters).every(([key, value]) => row[key] === value),
                ) ?? null);
          return Promise.resolve({ data, error: null });
        },
        then(resolve: (value: { error: null }) => unknown) {
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "finish_checkout_notification") {
        finished.push({
          id: String(args.p_notification_id),
          succeeded: Boolean(args.p_succeeded),
        });
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: notifications, error: null });
    },
  } as unknown as AdminSupabaseClient;
  return {
    deps: createCheckoutNotificationDependencies(admin, orderId),
    audits,
    finished,
    notifications,
  };
}

beforeEach(() => {
  jest
    .mocked(sendEmailWithRetry)
    .mockReset()
    .mockResolvedValue({ messageId: "smtp-accepted" });
});

it("sends the persisted paid-order summary to the fixed reseller with a separate audit", async () => {
  const { deps, audits, notifications } = fixture();
  await deps.send(notifications[0]);
  expect(sendEmailWithRetry).toHaveBeenCalledWith(
    expect.objectContaining({
      to: seller,
      subject: expect.stringContaining("New paid order"),
      text: expect.stringContaining("Jordan <Retro> (10) x2"),
      html: expect.stringContaining("Jordan &lt;Retro&gt;"),
    }),
    expect.anything(),
  );
  const email = jest.mocked(sendEmailWithRetry).mock.calls[0][0];
  expect(email.text).toContain("Items: 3");
  expect(email.text).toContain("Total: $180.30");
  expect(email.text).toContain("Local pickup");
  expect(email.text).toContain("buyer@example.com");
  expect(email.html).toContain(`https://example.com/admin/transactions/${orderId}`);
  expect(email.html).not.toContain("Jordan <Retro>");
  expect(email.html).not.toContain("/order-status/");
  expect(audits).toEqual([
    expect.objectContaining({
      email_type: "reseller_order_placed",
      recipient_email: seller,
      notification_id: notifications[0].id,
      order_id: orderId,
      delivery_status: "sent",
      message_id: "smtp-accepted",
    }),
  ]);
});

it("accepts the new queue kind and handles reseller, customer and pickup independently", async () => {
  const { deps, audits, finished } = fixture([
    "order_confirmation",
    "pickup_instructions",
    "reseller_order_placed",
  ]);
  await expect(processCheckoutNotifications(deps, 3)).resolves.toEqual({
    claimed: 3,
    sent: 3,
    failed: 0,
  });
  expect(audits.map((row) => [row.email_type, row.recipient_email])).toEqual([
    ["order_confirmation", "buyer@example.com"],
    ["pickup_instructions", "buyer@example.com"],
    ["reseller_order_placed", seller],
  ]);
  expect(finished.every((row) => row.succeeded)).toBe(true);
});

it("still alerts the reseller when the customer email is missing", async () => {
  const { deps, audits, finished } = fixture(
    ["order_confirmation", "reseller_order_placed"],
    null,
  );
  await expect(processCheckoutNotifications(deps, 3)).resolves.toEqual({
    claimed: 2,
    sent: 1,
    failed: 1,
  });
  expect(audits[0]).toMatchObject({ recipient_email: seller, delivery_status: "sent" });
  expect(finished.map((row) => row.succeeded)).toEqual([false, true]);
});

it("keeps customer confirmation successful when the reseller send fails", async () => {
  jest
    .mocked(sendEmailWithRetry)
    .mockImplementation((input) =>
      input.to === seller
        ? Promise.reject(new Error("SMTP unavailable"))
        : Promise.resolve({ messageId: "customer-accepted" }),
    );
  const { deps, audits, finished } = fixture([
    "reseller_order_placed",
    "order_confirmation",
  ]);
  await expect(processCheckoutNotifications(deps, 3)).resolves.toEqual({
    claimed: 2,
    sent: 1,
    failed: 1,
  });
  expect(audits).toEqual([
    expect.objectContaining({ recipient_email: seller, delivery_status: "failed" }),
    expect.objectContaining({
      recipient_email: "buyer@example.com",
      delivery_status: "sent",
    }),
  ]);
  expect(finished.map((row) => row.succeeded)).toEqual([false, true]);
});

it("does not resend an accepted reseller email when queue completion is retried", async () => {
  const { deps, notifications } = fixture();
  await deps.send(notifications[0]);
  await deps.send(notifications[0]);
  expect(sendEmailWithRetry).toHaveBeenCalledTimes(1);
});
