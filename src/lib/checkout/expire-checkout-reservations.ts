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
        await deps.cancelSquareOrder(checkout.squareOrderId, checkout.squareOrderVersion);
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
