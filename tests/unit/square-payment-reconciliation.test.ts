import { SquareClient } from "square";
import { reconcilePendingSquarePayment } from "@/lib/square/payment-reconciliation";
import { squarePaymentDetails, squareSourceEvidence } from "@/lib/square/payment-details";

describe("reconcilePendingSquarePayment", () => {
  it("processes the locally recorded direct payment when its webhook is delayed", async () => {
    const processPayment = jest.fn().mockResolvedValue({
      duplicate: false,
      fulfillmentAuthorized: true,
      orderId: "local-order-1",
    });
    // Exercise the same SDK get/deserialize/evidence path used by the order route.
    const response = Response.json({
      payment: {
        id: "payment-1",
        updated_at: "2026-09-06T00:00:01-04:00",
        card_details: {
          card_payment_timeline: { captured_at: "2026-09-05T23:59:59-04:00" },
        },
      },
    });
    const square = new SquareClient({
      token: "fixture",
      fetch: () => Promise.resolve(response),
    });
    const { payment } = await square.payments.get({ paymentId: "payment-1" });
    if (!payment) throw new Error("fixture payment missing");
    const result = await reconcilePendingSquarePayment("local-order-1", {
      getLocalOrder: jest.fn().mockResolvedValue({
        id: "local-order-1",
        status: "pending",
        squareOrderId: "square-order-1",
        paymentId: "payment-1",
      }),
      getSquareOrder: jest.fn().mockResolvedValue({
        id: "square-order-1",
        locationId: "location-1",
        referenceId: "local-order-1",
        tenders: [],
      }),
      getSquarePayment: jest.fn().mockResolvedValue({
        id: "payment-1",
        orderId: "square-order-1",
        locationId: "location-1",
        status: "COMPLETED",
        amountCents: 10825,
        currency: "USD",
        riskLevel: "NORMAL",
        createdAt: "2026-09-05T18:03:33.155Z",
        versionToken: "version-1",
        sourceEvidence: squareSourceEvidence(payment),
        details: squarePaymentDetails({
          sourceType: "WALLET",
          walletDetails: { brand: "CASH_APP" },
        }),
      }),
      processPayment,
    });

    expect(result).toBe("processed");
    expect(processPayment).toHaveBeenCalledWith({
      eventId: "reconcile:payment-1:version-1",
      eventType: "payment.reconciled",
      merchantId: "reconciliation",
      locationId: "location-1",
      createdAt: "2026-09-05T18:03:33.155Z",
      paymentId: "payment-1",
      squareOrderId: "square-order-1",
      paymentStatus: "COMPLETED",
      amountCents: 10825,
      currency: "USD",
      riskLevel: "NORMAL",
      sourceEvidence: {
        capturedAt: "2026-09-05T23:59:59-04:00",
        resolvedAt: "2026-09-06T00:00:01-04:00",
      },
      details: expect.objectContaining({ payment_method: "cashAppPay" }),
    });
  });

  it("refuses a Square order that is not bound to the requested local order", async () => {
    const getSquarePayment = jest.fn();
    const processPayment = jest.fn();

    await expect(
      reconcilePendingSquarePayment("local-order-1", {
        getLocalOrder: jest.fn().mockResolvedValue({
          id: "local-order-1",
          status: "pending",
          squareOrderId: "square-order-1",
          paymentId: null,
        }),
        getSquareOrder: jest.fn().mockResolvedValue({
          id: "square-order-1",
          locationId: "location-1",
          referenceId: "another-local-order",
          tenders: [{ paymentId: "payment-1" }],
        }),
        getSquarePayment,
        processPayment,
      }),
    ).rejects.toThrow("square_reconciliation_order_mismatch");
    expect(getSquarePayment).not.toHaveBeenCalled();
    expect(processPayment).not.toHaveBeenCalled();
  });
});
