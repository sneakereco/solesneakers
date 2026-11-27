import { squareSourceEvidence, squarePaymentDetails } from "@/lib/square/payment-details";

it("separates an SDK card capture from a later update and omits invalid timeline evidence", () => {
  const updatedAt = "2026-11-26T00:00:01-05:00";
  const capturedAt = "2026-11-25T23:59:59-05:00";
  expect(
    squareSourceEvidence({
      updatedAt,
      cardDetails: { cardPaymentTimeline: { capturedAt } },
    }),
  ).toEqual({ capturedAt, resolvedAt: updatedAt });
  expect(
    squareSourceEvidence({
      updatedAt,
      cardDetails: { cardPaymentTimeline: { capturedAt: "not-a-date" } },
    }),
  ).toEqual({ resolvedAt: updatedAt });
  expect(squareSourceEvidence({ updatedAt })).toEqual({ resolvedAt: updatedAt });
});

it("uses signed USD provider fees and exact server payment correlation", () => {
  const orderId = "34a328d0-4cfc-4ca7-a9f8-ade895f43c33";
  const attemptId = "31a328d0-4cfc-8ca7-89f8-ade895f43c33";
  const effectiveAt = "2026-11-25T10:00:00Z";
  expect(
    squareSourceEvidence({
      referenceId: orderId,
      note: `Sole Sneakers order ${orderId} attempt ${attemptId}`,
      processingFee: [
        { effectiveAt, type: "INITIAL", amountMoney: { currency: "USD", amount: 125n } },
        {
          effectiveAt,
          type: "ADJUSTMENT",
          amountMoney: { currency: "USD", amount: -25n },
        },
        { effectiveAt, type: "ADJUSTMENT", amountMoney: { currency: "EUR", amount: 3 } },
      ],
    }),
  ).toEqual({
    orderReference: orderId,
    attemptId,
    fees: [
      { effectiveAt, type: "INITIAL", adjustment: "charge", amountCents: 125 },
      { effectiveAt, type: "ADJUSTMENT", adjustment: "credit", amountCents: 25 },
    ],
  });
  expect(squareSourceEvidence({ note: "untrusted note" })).toEqual({});
});
it.each([
  [{ sourceType: "WALLET", walletDetails: { brand: "CASH_APP" } }, "cashAppPay"],
  [
    { sourceType: "BUY_NOW_PAY_LATER", buyNowPayLaterDetails: { brand: "AFTERPAY" } },
    "afterpay",
  ],
  [
    { sourceType: "BUY_NOW_PAY_LATER", buyNowPayLaterDetails: { brand: "CLEARPAY" } },
    "afterpay",
  ],
  [{ sourceType: "CARD", cardDetails: { card: { cardBrand: "VISA" } } }, null],
] as const)(
  "normalizes provider details without guessing a card wallet",
  (payment, method) => {
    expect(squarePaymentDetails(payment).payment_method).toBe(method);
  },
);
