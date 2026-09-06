import { verifySquarePaymentOrder } from "@/lib/square/payment-order-verification";

const payment = {
  eventId: "event-1",
  eventType: "payment.updated",
  merchantId: "merchant-1",
  locationId: "location-1",
  createdAt: "2026-09-05T18:03:32.000Z",
  paymentId: "payment-1",
  squareOrderId: "square-order-1",
  paymentStatus: "COMPLETED",
  amountCents: 10825,
  currency: "USD",
  riskLevel: "NORMAL",
};

const matchingDeps = () => ({
  getLocalOrder: jest.fn().mockResolvedValue({
    id: "local-order-1",
    subtotal: 100,
    shipping: 0,
  }),
  getSquareOrder: jest.fn().mockResolvedValue({
    order: {
      id: "square-order-1",
      referenceId: "local-order-1",
      locationId: "location-1",
      totalMoney: { amount: BigInt(10825), currency: "USD" },
      totalTaxMoney: { amount: BigInt(825), currency: "USD" },
    },
  }),
});

describe("verifySquarePaymentOrder", () => {
  it("accepts a payment matching the bound Square order and final tax", async () => {
    await expect(verifySquarePaymentOrder(payment, matchingDeps())).resolves.toBe(
      undefined,
    );
  });

  it("rejects a completed payment that does not equal the Square order total", async () => {
    const deps = matchingDeps();
    deps.getSquareOrder.mockResolvedValue({
      order: {
        id: "square-order-1",
        referenceId: "local-order-1",
        locationId: "location-1",
        totalMoney: { amount: BigInt(10900), currency: "USD" },
        totalTaxMoney: { amount: BigInt(900), currency: "USD" },
      },
    });

    await expect(verifySquarePaymentOrder(payment, deps)).rejects.toThrow(
      "square_payment_order_total_mismatch",
    );
  });
});
