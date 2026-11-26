"use client";
import { useState } from "react";
import { useCart } from "./CartProvider";
export function BasketAccessNotice() {
  const { access, retryAccess, repairReason, resetSavedBasket } = useCart();
  const [confirm, setConfirm] = useState<typeof resetSavedBasket | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <div className="p-6 text-center" role="status">
      <p>
        {repairReason
          ? "This saved cart is too large to open. Its contents have been preserved."
          : access === "checking"
            ? "Loading your cart…"
            : access === "denied"
              ? "Your cart access has changed."
              : "Your cart is temporarily unavailable."}
      </p>
      {repairReason && (
        <div>
          {confirm === resetSavedBasket ? (
            <>
              <p>Resetting removes all items from this saved cart.</p>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setConfirm(null);
                  void confirm().then((result) => setFailed(result.status !== "saved"));
                }}
              >
                Confirm reset
              </button>
              <button
                type="button"
                className="ml-3 underline"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="underline"
              onClick={() => {
                setFailed(false);
                setConfirm(() => resetSavedBasket);
              }}
            >
              Reset this saved cart
            </button>
          )}
          {failed && <p>The cart changed or could not be reset. Retry cart access.</p>}
        </div>
      )}
      {access !== "checking" && (
        <button type="button" className="mt-3 underline" onClick={retryAccess}>
          Retry cart access
        </button>
      )}
    </div>
  );
}

export function BasketRepairNotice() {
  return (
    <p className="px-5 py-3 text-sm" role="status">
      Some saved cart items could not be read. Your next cart edit will save the items
      shown.
    </p>
  );
}
