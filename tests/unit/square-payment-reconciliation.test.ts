import { reconcilePendingSquarePayment } from "@/lib/square/payment-reconciliation";

describe("reconcilePendingSquarePayment", () => {
  it("processes the locally recorded direct payment when its webhook is delayed", async () => {
    const processPayment = jest.fn().mockResolvedValue({
      duplicate: false,
      fulfillmentAuthorized: true,
      orderId: "local-order-1",
    });
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
