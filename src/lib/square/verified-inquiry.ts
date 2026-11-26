import type * as Square from "square";
import {
  financialFact,
  type VerifiedFinancialFact,
} from "@/Modules/Checkout/Source/Features/Payments/payment-facts";

type Attempt = {
  id: string;
  order_id: string;
  square_order_id: string | null;
  amount_cents: number;
  currency: string;
  provider_payment_id: string | null;
  method: string;
  dispatched_at: string | null;
};
type Local = {
  id: string;
  square_order_id: string | null;
  checkout_attempt_guarded: boolean;
  payment_transaction_id: string | null;
  fulfillment_status: string | null;
};
type Inquiry = {
  merchantId: string;
  locationId: string;
  merchantLocation: Square.Location;
  payment: Square.Payment;
  order:
    | Square.Order
    | Pick<Square.Order, "id" | "referenceId" | "locationId" | "totalMoney">;
  local: Local;
  attempt: Attempt;
};

export function verifyPaymentInquiry({
  merchantId,
  locationId,
  merchantLocation,
  payment,
  order,
  local,
  attempt,
}: Inquiry) {
  const method = attempt.method;
  const correctSource =
    method === "cashAppPay"
      ? payment.sourceType === "WALLET" && payment.walletDetails?.brand === "CASH_APP"
      : method === "afterpay"
        ? payment.sourceType === "BUY_NOW_PAY_LATER" &&
          ["AFTERPAY", "CLEARPAY"].includes(payment.buyNowPayLaterDetails?.brand ?? "")
        : ["card", "applePay"].includes(method) && payment.sourceType === "CARD";
  const knownLegacy =
    !local.checkout_attempt_guarded &&
    !!payment.id &&
    local.payment_transaction_id === payment.id &&
    attempt.provider_payment_id === payment.id;
  if (
    !merchantId ||
    !locationId ||
    merchantLocation.id !== locationId ||
    merchantLocation.merchantId !== merchantId ||
    order.locationId !== locationId ||
    payment.locationId !== locationId ||
    !order.id ||
    payment.orderId !== order.id ||
    order.referenceId !== local.id ||
    local.square_order_id !== order.id ||
    attempt.square_order_id !== order.id ||
    attempt.order_id !== local.id ||
    !payment.id ||
    (attempt.provider_payment_id && attempt.provider_payment_id !== payment.id) ||
    (!knownLegacy &&
      (!local.checkout_attempt_guarded ||
        !attempt.dispatched_at ||
        payment.referenceId !== attempt.id ||
        !correctSource)) ||
    attempt.currency !== "USD" ||
    order.totalMoney?.currency !== "USD" ||
    order.totalMoney.amount !== BigInt(attempt.amount_cents) ||
    payment.amountMoney?.currency !== "USD" ||
    payment.amountMoney.amount !== BigInt(attempt.amount_cents) ||
    !payment.createdAt ||
    !Number.isFinite(Date.parse(payment.createdAt)) ||
    !payment.status ||
    !["APPROVED", "PENDING", "COMPLETED", "FAILED", "CANCELED"].includes(payment.status)
  )
    throw new Error("square_inquiry_binding_mismatch");
  const fact = financialFact.parse({
    kind: "payment",
    providerId: payment.id,
    paymentId: payment.id,
    orderId: local.id,
    providerVersion: payment.versionToken,
    amountCents: attempt.amount_cents,
    expectedTotalCents: attempt.amount_cents,
    status: payment.status,
    currency: "USD",
    fulfillmentStatus: local.fulfillment_status ?? "unfulfilled",
  });
  return {
    fact,
    createdAt: payment.createdAt,
    review:
      payment.riskEvaluation?.riskLevel === "HIGH"
        ? ("square_payment_high_risk" as const)
        : null,
  };
}

export function verifyRefundInquiry(
  refund: Square.PaymentRefund | undefined,
  refundId: string,
  payment: VerifiedFinancialFact,
  locationId: string,
  squareOrderId: string,
) {
  if (
    !refund ||
    refund.id !== refundId ||
    refund.paymentId !== payment.paymentId ||
    refund.locationId !== locationId ||
    (refund.orderId && refund.orderId !== squareOrderId) ||
    refund.amountMoney.currency !== "USD" ||
    !refund.updatedAt ||
    !refund.status ||
    !["PENDING", "COMPLETED", "FAILED", "REJECTED"].includes(refund.status) ||
    payment.status !== "COMPLETED"
  )
    throw new Error("square_refund_binding_mismatch");
  return financialFact.parse({
    ...payment,
    kind: "refund",
    providerId: refundId,
    providerVersion: refund.updatedAt,
    status: refund.status,
    amountCents: Number(refund.amountMoney.amount),
  });
}
