import { OrderEmailService } from "@/services/order-email-service";
import { sendEmailWithRetry } from "@/lib/email/mailer";

jest.mock("@/lib/email/mailer");

const input = { to: "buyer@example.com", orderId: "order-1", trackingNumber: "track-1" };
const rows: Array<Record<string, unknown>> = [];
let writeError: Error | null;
const admin = {
  from: () => ({
    insert: (row: Record<string, unknown>) => {
      if (!writeError) {
        rows.push({ ...row, id: "audit-1" });
      }
      return {
        select: () => ({
          single: () => Promise.resolve({ data: { id: "audit-1" }, error: writeError }),
        }),
      };
    },
    update: (patch: Record<string, unknown>) => ({
      eq: () => {
        Object.assign(rows[0], patch);
        return Promise.resolve({ error: null });
      },
    }),
  }),
};

beforeEach(() => {
  rows.length = 0;
  writeError = null;
  jest.mocked(sendEmailWithRetry).mockReset().mockResolvedValue({ messageId: "ses-1" });
});

it("records the actual shipment email and SES acceptance identifier", async () => {
  await new OrderEmailService(admin as never, "tenant-1").sendOrderInTransit(input);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    order_id: "order-1",
    tenant_id: "tenant-1",
    email_type: "in_transit",
    recipient_email: "buyer@example.com",
    delivery_status: "sent",
    message_id: "ses-1",
  });
  expect(rows[0].html_snapshot).toEqual(expect.stringContaining("track-1"));
});

it("records a failed delivery email and propagates the error for retry", async () => {
  jest.mocked(sendEmailWithRetry).mockRejectedValue(new Error("SMTP unavailable"));
  await expect(
    new OrderEmailService(admin as never, "tenant-1").sendOrderDelivered(input),
  ).rejects.toThrow("SMTP unavailable");
  expect(rows[0]).toMatchObject({ email_type: "delivered", delivery_status: "failed" });
});

it("does not send an untraceable email when creating its audit fails", async () => {
  writeError = new Error("audit unavailable");
  await expect(
    new OrderEmailService(admin as never, "tenant-1").sendOrderInTransit(input),
  ).rejects.toThrow("audit unavailable");
  expect(sendEmailWithRetry).not.toHaveBeenCalled();
});
