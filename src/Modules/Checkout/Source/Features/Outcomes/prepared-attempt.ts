import type { CartPurchaseActions, PurchaseLine } from "@/Modules/Cart/Source/Client";
import { resolveCheckoutAttempt } from "./client-session";

export async function capturePreparedAttempt(
  cart: CartPurchaseActions,
  expected: readonly PurchaseLine[],
  fingerprint: (items: readonly PurchaseLine[]) => string,
  signal: AbortSignal,
  refreshQuote: () => void,
  isRenderedViewCurrent: () => boolean,
  ownerId?: string | null,
) {
  const original = fingerprint(expected);
  const attempt = resolveCheckoutAttempt(original);
  attempt.protectIssuedAttempt();
  const result = await cart.captureForCheckout(
    {
      mode: attempt.mode,
      attemptKey: attempt.key,
      expectedItems: expected,
    },
    signal,
  );
  if (result.status !== "captured") attempt.rejectCapture();
  const resumedWithoutProof =
    attempt.mode === "resume" &&
    isRenderedViewCurrent() &&
    (result.status === "missing" ||
      result.status === "corrupt" ||
      (result.status === "stale" && attempt.interruptedSwitch()));
  const items = result.status === "captured" ? result.items : expected;
  if (
    signal.aborted ||
    (result.status !== "captured" && !resumedWithoutProof) ||
    fingerprint(items) !== original ||
    !attempt.commit()
  ) {
    refreshQuote();
    throw Error("Your checkout changed. Review the updated order before paying.");
  }
  return {
    applyStockConflicts:
      result.status === "captured" ? result.applyStockConflicts : undefined,
    key: attempt.key,
    current: attempt.current,
    recoveryOnly: resumedWithoutProof,
    items: [...items],
    reject: () => !signal.aborted && attempt.reject(),
    async prepared(orderId: string, token?: string) {
      if (signal.aborted || !attempt.current())
        throw Error("Your checkout changed. Review your current order.");
      const bound =
        result.status === "captured" &&
        (await cart
          .bindPreparedOrder(result.captureId, orderId, signal)
          .catch(() => false));
      if (signal.aborted || !attempt.prepared(orderId, token, bound, ownerId))
        throw Error("Your checkout changed. Review your current order.");
      return bound;
    },
  };
}
