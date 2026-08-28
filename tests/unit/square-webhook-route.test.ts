jest.mock("@/lib/square/config", () => ({
  getSquareConfig: jest.fn(() => ({
    environment: "sandbox",
    accessToken: "token",
    locationId: "location-1",
    webhookSignatureKey: "signature-key",
    webhookNotificationUrl: "https://shop.example.com/api/webhooks/square",
  })),
}));

jest.mock("@/lib/square/webhook", () => ({
  verifySquareWebhookSignature: jest.fn(),
}));

jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(() => ({})),
}));

import { SquarePaymentEventProcessor } from "@/lib/square/payment-event";
import { verifySquareWebhookSignature } from "@/lib/square/webhook";

import { POST } from "../../app/api/webhooks/square/route";

const mockVerifySignature = jest.mocked(verifySquareWebhookSignature);

function webhookRequest(body: string, signature = "signature"): Request {
  return new Request("https://shop.example.com/api/webhooks/square", {
    method: "POST",
    headers: { "x-square-hmacsha256-signature": signature },
    body,
  });
}

describe("POST /api/webhooks/square", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects an invalid signature before parsing or writing", async () => {
    mockVerifySignature.mockResolvedValue(false);
    const process = jest.spyOn(SquarePaymentEventProcessor.prototype, "process");

    const response = await POST(webhookRequest('{"event_id":"event-1"}'));

    expect(response.status).toBe(401);
    expect(process).not.toHaveBeenCalled();
  });

  it("acknowledges a verified and durably processed event", async () => {
    mockVerifySignature.mockResolvedValue(true);
    jest.spyOn(SquarePaymentEventProcessor.prototype, "process").mockResolvedValue({
      duplicate: false,
      fulfillmentAuthorized: true,
      orderId: "order-1",
    });
    const body = '{"event_id":"event-1"}';

    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(200);
    expect(SquarePaymentEventProcessor.prototype.process).toHaveBeenCalledWith(body);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns a retryable error when durable processing fails", async () => {
    mockVerifySignature.mockResolvedValue(true);
    jest
      .spyOn(SquarePaymentEventProcessor.prototype, "process")
      .mockRejectedValue(new Error("database unavailable"));

    const response = await POST(webhookRequest('{"event_id":"event-1"}'));

    expect(response.status).toBe(500);
  });
});
