"use client";
import { useCart } from "./CartProvider";
export function BasketAccessNotice() {
  const { access, retryAccess, repairReason } = useCart();
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
