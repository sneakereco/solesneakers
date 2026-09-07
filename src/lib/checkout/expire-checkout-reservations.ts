export type ExpiredCheckout = {
  orderId: string;
  squarePaymentLinkId: string | null;
  squarePaymentLinkDeletedAt: string | null;
  squareOrderId: string | null;
  squareOrderVersion: number | null;
};

export type ExpireCheckoutDependencies = {
  deleteSquareLink(paymentLinkId: string): Promise<void>;
  markSquareLinkDeleted(orderId: string, paymentLinkId: string): Promise<void>;
  getSquareOrder(
    squareOrderId: string,
  ): Promise<{ state: string; version: number; hasPayment: boolean }>;
  cancelSquareOrder(squareOrderId: string, version: number): Promise<void>;
  releaseReservation(orderId: string, reason: string): Promise<boolean>;
  reportError(error: unknown, orderId: string): void;
};

export type ExpireCheckoutResult = {
  examined: number;
  released: number;
  failed: number;
};

export async function expireCheckoutReservations(
  checkouts: ExpiredCheckout[],
  deps: ExpireCheckoutDependencies,
): Promise<ExpireCheckoutResult> {
  const result: ExpireCheckoutResult = {
    examined: checkouts.length,
    released: 0,
    failed: 0,
  };

  for (const checkout of checkouts) {
    try {
      if (checkout.squarePaymentLinkId && !checkout.squarePaymentLinkDeletedAt) {
        await deps.deleteSquareLink(checkout.squarePaymentLinkId);
        await deps.markSquareLinkDeleted(checkout.orderId, checkout.squarePaymentLinkId);
      }

      if (
        !checkout.squarePaymentLinkId &&
        checkout.squareOrderId &&
        checkout.squareOrderVersion !== null
      ) {
        const currentOrder = await deps.getSquareOrder(checkout.squareOrderId);
        if (currentOrder.hasPayment) {
          throw new Error("square_order_payment_requires_reconciliation");
        }
        if (currentOrder.state === "OPEN") {
          await deps.cancelSquareOrder(checkout.squareOrderId, currentOrder.version);
        } else if (currentOrder.state !== "CANCELED") {
          throw new Error(`square_order_not_cancelable:${currentOrder.state}`);
        }
      }

      const released = await deps.releaseReservation(
        checkout.orderId,
        "checkout_expired",
      );
      if (released) {
        result.released += 1;
      }
    } catch (error) {
      result.failed += 1;
      deps.reportError(error, checkout.orderId);
    }
  }

  return result;
}
