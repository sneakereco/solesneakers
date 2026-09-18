jest.mock("@/lib/auth/session", () => ({ requireAdminApi: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: jest.fn() }));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));

import { requireAdminApi } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { GET } from "@/app/api/admin/transactions/[orderId]/route";

it("keeps Square lifecycle and email history without querying retired event stores", async () => {
  const records: Record<string, unknown> = {
    orders: { id: "order-1", guest_email: "buyer@example.com", status: "paid" },
    payment_transactions: [{ id: "payment-1", square_payment_id: "square-1" }],
    square_refunds: [
      {
        square_refund_id: "refund-1",
        status: "COMPLETED",
        updated_at: "2026-09-18T12:00:00Z",
      },
    ],
    square_disputes: [
      {
        square_dispute_id: "dispute-1",
        state: "EVIDENCE_REQUIRED",
        updated_at: "2026-09-18T13:00:00Z",
      },
    ],
    email_audit_log: [{ id: "email-1" }],
  };
  const from = jest.fn((table: string) => {
    if (!(table in records)) {
      throw new Error(`Unexpected table: ${table}`);
    }
    const result = { data: records[table], error: null };
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve(result)),
      maybeSingle: jest.fn(() => Promise.resolve(result)),
    };
    return query;
  });
  jest.mocked(createSupabaseAdminClient).mockReturnValue({ from } as never);
  jest.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
  const response = await GET(
    new Request("https://shop.test/api/admin/transactions/order-1") as never,
    {
      params: Promise.resolve({ orderId: "order-1" }),
    },
  );
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(
    payload.paymentEvents.map((event: { event_type: string }) => event.event_type),
  ).toEqual(["square_refund_completed", "square_dispute_alert"]);
  expect(payload.emailLogs).toEqual(records.email_audit_log);
  expect(payload.paymentTransaction.id).toBe("payment-1");
  expect(payload).not.toHaveProperty("trackingEvents");
  expect(payload).not.toHaveProperty("checkoutLogs");
  expect(requireAdminApi).toHaveBeenCalled();
});
