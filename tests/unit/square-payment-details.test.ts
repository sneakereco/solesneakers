import { squarePaymentDetails } from "@/lib/square/payment-details";

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
