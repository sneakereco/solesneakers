import type {
  SquarePaymentEventResult,
  SquarePaymentSnapshot,
} from "@/lib/square/payment-event";

type LocalOrder = {
  id: string;
  status: string | null;
  squareOrderId: string | null;
};

type SquareOrder = {
  id: string;
  locationId: string;
  referenceId: string | null;
  tenders: Array<{ paymentId: string | null }>;
};

type SquarePayment = {
  id: string;
  orderId: string;
  locationId: string;
  status: string;
  amountCents: number;
  currency: string;
  riskLevel: string | null;
  createdAt: string;
  versionToken: string;
};

export type SquarePaymentReconciliationDependencies = {
  getLocalOrder(orderId: string): Promise<LocalOrder | null>;
  getSquareOrder(squareOrderId: string): Promise<SquareOrder | null>;
  getSquarePayment(paymentId: string): Promise<SquarePayment | null>;
  processPayment(input: SquarePaymentSnapshot): Promise<SquarePaymentEventResult>;
};

export async function reconcilePendingSquarePayment(
  orderId: string,
  deps: SquarePaymentReconciliationDependencies,
): Promise<"skipped" | "processed"> {
  const local = await deps.getLocalOrder(orderId);
  if (!local || local.status !== "pending" || !local.squareOrderId) {
    return "skipped";
  }

  const squareOrder = await deps.getSquareOrder(local.squareOrderId);
  if (
    !squareOrder ||
    squareOrder.id !== local.squareOrderId ||
    squareOrder.referenceId !== local.id
  ) {
    throw new Error("square_reconciliation_order_mismatch");
  }

  const paymentId = squareOrder.tenders.find((tender) => tender.paymentId)?.paymentId;
  if (!paymentId) {
    return "skipped";
  }

  const payment = await deps.getSquarePayment(paymentId);
  if (!payment || payment.status !== "COMPLETED") {
    return "skipped";
  }
  if (
    payment.id !== paymentId ||
    payment.orderId !== squareOrder.id ||
    payment.locationId !== squareOrder.locationId
  ) {
    throw new Error("square_reconciliation_payment_mismatch");
  }

  await deps.processPayment({
    eventId: `reconcile:${payment.id}:${payment.versionToken}`,
    eventType: "payment.reconciled",
    merchantId: "reconciliation",
    locationId: payment.locationId,
    createdAt: payment.createdAt,
    paymentId: payment.id,
    squareOrderId: payment.orderId,
    paymentStatus: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
    riskLevel: payment.riskLevel,
  });
  return "processed";
}
