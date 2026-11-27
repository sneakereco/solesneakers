"use client";
import { useCart } from "./CartProvider";
export function CartFeedback() {
  const { isReady, validationStatus, writePending, writeError, retryValidation } =
    useCart();
  return (
    <>
      {validationStatus === "loading" && (
        <p role="status" className="px-5 py-2 text-sm">
          {isReady ? "Checking item availability…" : "Refreshing your cart…"}
        </p>
      )}
      {validationStatus === "error" && (
        <p role="alert" className="px-5 py-2 text-sm">
          Could not load or check your cart.{" "}
          <button type="button" className="underline" onClick={retryValidation}>
            Try again
          </button>
        </p>
      )}
      {writePending && (
        <p role="status" className="px-5 py-2 text-sm">
          Saving your cart…
        </p>
      )}
      {writeError && (
        <p role="alert" className="px-5 py-2 text-sm">
          {writeError}
        </p>
      )}
    </>
  );
}
