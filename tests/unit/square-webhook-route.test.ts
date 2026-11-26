import { createHash, createHmac } from "node:crypto";
import { POST } from "../../src/app/api/webhooks/square/route";
const mockRpc = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: () => ({ rpc: mockRpc }),
}));
jest.mock("@/lib/square/config", () => ({
  getSquareConfig: () => ({
    locationId: "loc",
    webhookSignatureKey: "fixture-key",
    webhookNotificationUrl: "https://fixture.invalid/api/webhooks/square",
  }),
  getSquareMerchantId: () => "merchant",
}));
const url = "https://fixture.invalid/api/webhooks/square";
const event = {
  type: "payment.updated",
  merchant_id: "merchant",
  event_id: "event-1",
  created_at: "2026-11-25T10:00:00Z",
  data: {
    type: "payment",
    id: "pay",
    object: {
      payment: {
        id: "pay",
        location_id: "loc",
        order_id: "sq",
        card_details: { private: "sentinel" },
        amount_money: { amount: 1000, currency: "USD" },
      },
    },
  },
};
function post(
  raw: string,
  signature = createHmac("sha256", "fixture-key")
    .update(url + raw)
    .digest("base64"),
) {
  return POST(
    new Request(url, {
      method: "POST",
      headers: { "x-square-hmacsha256-signature": signature },
      body: raw,
    }),
  );
}
beforeEach(() => mockRpc.mockReset());
it.each(["stored", "duplicate"])(
  "acknowledges a signed %s receipt with only bounded provider references",
  async (result) => {
    mockRpc.mockResolvedValue({ data: result, error: null });
    const raw = JSON.stringify(event);
    expect((await post(raw)).status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("receive_checkout_square_event", {
      p_event_id: "event-1",
      p_kind: "payment.updated",
      p_payload_hash: createHash("sha256").update(raw).digest("hex"),
      p_payload: {
        merchantId: "merchant",
        locationId: "loc",
        paymentId: "pay",
        squareOrderId: "sq",
        createdAt: event.created_at,
      },
    });
  },
);
it("returns retryable failure if the receipt cannot be committed", async () => {
  mockRpc.mockResolvedValue({ error: { message: "private fixture" }, data: null });
  const res = await post(JSON.stringify(event));
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain("private");
});
it("rejects malformed, oversized, unsigned and foreign supported events before storage", async () => {
  expect((await post("{")).status).toBe(400);
  expect((await post("x".repeat(300000))).status).toBe(413);
  expect((await post(JSON.stringify(event), "bad")).status).toBe(401);
  expect((await post(JSON.stringify({ ...event, merchant_id: "other" }))).status).toBe(
    403,
  );
  expect(mockRpc).not.toHaveBeenCalled();
});
it("acknowledges an unsupported signed kind without storage", async () => {
  expect((await post(JSON.stringify({ type: "invoice.updated" }))).status).toBe(200);
  expect(mockRpc).not.toHaveBeenCalled();
});
