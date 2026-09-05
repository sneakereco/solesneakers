import { SquarePaymentEventProcessor } from "@/lib/square/payment-event";

const completedPaymentEvent = {
  merchant_id: "merchant-1",
  type: "payment.updated",
  event_id: "event-1",
  created_at: "2026-08-26T18:00:00.000Z",
  data: {
    type: "payment",
    id: "payment-1",
    object: {
      payment: {
        id: "payment-1",
        order_id: "square-order-1",
        location_id: "location-1",
        status: "COMPLETED",
        amount_money: { amount: 14980, currency: "USD" },
        risk_evaluation: { risk_level: "NORMAL" },
        buyer_email_address: "buyer@example.com",
        card_details: { card: { last_4: "4242" } },
      },
    },
  },
};

const completedRefundEvent = {
  merchant_id: "merchant-1",
  type: "refund.updated",
  event_id: "refund-event-1",
  created_at: "2026-08-27T18:00:00.000Z",
  data: {
    type: "refund",
    id: "refund-1",
    object: {
      refund: {
        id: "refund-1",
        status: "COMPLETED",
        location_id: "location-1",
        payment_id: "payment-1",
        amount_money: { amount: 5000, currency: "USD" },
        reason: "Customer return",
      },
    },
  },
};

const disputeCreatedEvent = {
  merchant_id: "merchant-1",
  location_id: "location-1",
  type: "dispute.created",
  event_id: "dispute-event-1",
  created_at: "2026-08-28T18:00:00.000Z",
  data: {
    type: "dispute",
    id: "dispute-1",
    object: {
      dispute: {
        id: "dispute-1",
        state: "INQUIRY_EVIDENCE_REQUIRED",
        reason: "FRAUD",
        due_at: "2026-09-04T18:00:00.000Z",
        location_id: "location-1",
        amount_money: { amount: 14980, currency: "USD" },
        disputed_payment: { payment_id: "payment-1" },
      },
    },
  },
};

describe("SquarePaymentEventProcessor", () => {
  it("persists a sanitized, idempotent payment transition through one RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        duplicate: false,
        fulfillment_authorized: true,
        order_id: "local-order-1",
      },
      error: null,
    });
    const processor = new SquarePaymentEventProcessor({ rpc } as never, "location-1");
    const rawBody = JSON.stringify(completedPaymentEvent);

    await expect(processor.process(rawBody)).resolves.toEqual({
      duplicate: false,
      fulfillmentAuthorized: true,
      orderId: "local-order-1",
      paymentStatus: "COMPLETED",
      squareOrderId: "square-order-1",
    });

    expect(rpc).toHaveBeenCalledWith(
      "process_square_payment_event",
      expect.objectContaining({
        p_square_event_id: "event-1",
        p_square_order_id: "square-order-1",
        p_square_payment_id: "payment-1",
        p_payment_status: "COMPLETED",
        p_amount_cents: 14980,
        p_currency: "USD",
        p_risk_level: "NORMAL",
        p_payload_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_event_data: {
          amountCents: 14980,
          currency: "USD",
          paymentId: "payment-1",
          paymentStatus: "COMPLETED",
          riskLevel: "NORMAL",
          squareOrderId: "square-order-1",
        },
      }),
    );

    const args = rpc.mock.calls[0]?.[1];
    expect(JSON.stringify(args)).not.toContain("buyer@example.com");
    expect(JSON.stringify(args)).not.toContain("4242");
  });

  it("ignores a signed event for another configured location", async () => {
    const rpc = jest.fn();
    const processor = new SquarePaymentEventProcessor({ rpc } as never, "location-2");

    await expect(
      processor.process(JSON.stringify(completedPaymentEvent)),
    ).resolves.toEqual({
      ignored: true,
      reason: "location_mismatch",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("persists refund updates idempotently against the Square payment", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { duplicate: false, fulfillment_authorized: false, order_id: "order-1" },
      error: null,
    });
    const processor = new SquarePaymentEventProcessor({ rpc } as never, "location-1");

    await processor.process(JSON.stringify(completedRefundEvent));

    expect(rpc).toHaveBeenCalledWith("process_square_refund_event", {
      p_amount_cents: 5000,
      p_currency: "USD",
      p_event_data: {
        amountCents: 5000,
        currency: "USD",
        paymentId: "payment-1",
        reason: "Customer return",
        refundId: "refund-1",
        refundStatus: "COMPLETED",
      },
      p_event_type: "refund.updated",
      p_location_id: "location-1",
      p_merchant_id: "merchant-1",
      p_payload_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_refund_status: "COMPLETED",
      p_square_created_at: "2026-08-27T18:00:00.000Z",
      p_square_event_id: "refund-event-1",
      p_square_payment_id: "payment-1",
      p_square_refund_id: "refund-1",
    });
  });

  it("records standard Square dispute alerts without treating them as pre-dispute alerts", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { duplicate: false, fulfillment_authorized: false, order_id: "order-1" },
      error: null,
    });
    const processor = new SquarePaymentEventProcessor({ rpc } as never, "location-1");

    await processor.process(JSON.stringify(disputeCreatedEvent));

    expect(rpc).toHaveBeenCalledWith("process_square_dispute_event", {
      p_amount_cents: 14980,
      p_currency: "USD",
      p_dispute_reason: "FRAUD",
      p_dispute_state: "INQUIRY_EVIDENCE_REQUIRED",
      p_due_at: "2026-09-04T18:00:00.000Z",
      p_event_data: {
        amountCents: 14980,
        currency: "USD",
        disputeId: "dispute-1",
        disputeState: "INQUIRY_EVIDENCE_REQUIRED",
        dueAt: "2026-09-04T18:00:00.000Z",
        paymentId: "payment-1",
        reason: "FRAUD",
      },
      p_event_type: "dispute.created",
      p_location_id: "location-1",
      p_merchant_id: "merchant-1",
      p_payload_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_square_created_at: "2026-08-28T18:00:00.000Z",
      p_square_dispute_id: "dispute-1",
      p_square_event_id: "dispute-event-1",
      p_square_payment_id: "payment-1",
    });
  });

  it("rejects malformed or unsupported event bodies before database access", async () => {
    const rpc = jest.fn();
    const processor = new SquarePaymentEventProcessor({ rpc } as never, "location-1");

    await expect(processor.process('{"type":"payment.updated"}')).rejects.toThrow(
      "square_webhook_invalid_event",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
