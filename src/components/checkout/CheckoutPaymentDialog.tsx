"use client";

import { useLayoutEffect, useRef } from "react";

import type { ShippingAddressValidationError } from "@/lib/checkout/shipping-address-validation";

export function CheckoutPaymentDialog({
  open,
  error,
  onDismiss,
  stage = "processing",
  addressReview,
  onAcceptAddress,
}: {
  open: boolean;
  addressReview?: ShippingAddressValidationError | null;
  onAcceptAddress?: () => void;
  stage?: "preparing" | "afterpay" | "processing";
  error?: string | null;
  onDismiss?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) {
      element?.showModal();
    }
    if (!open && element?.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="checkout-payment-title"
      aria-describedby="checkout-payment-description"
      onCancel={(event) => {
        event.preventDefault();
        if (error) {
          onDismiss?.();
        }
      }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border-0 bg-white p-8 text-center text-zinc-900 shadow-xl backdrop:bg-black/50"
    >
      {!error && (
        <div
          aria-hidden="true"
          className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 motion-reduce:animate-none"
        />
      )}
      <h2 id="checkout-payment-title" className="text-xl font-semibold">
        {error
          ? addressReview
            ? "Check your shipping address"
            : "Payment could not be completed"
          : stage === "afterpay"
            ? "Opening Afterpay"
            : stage === "preparing"
              ? "Preparing checkout"
              : "Processing your payment"}
      </h2>
      <p
        id="checkout-payment-description"
        role={error ? "alert" : "status"}
        className="mt-3 text-sm text-zinc-600"
      >
        {error ||
          (stage === "afterpay"
            ? "Continue in the Afterpay window to review and approve your payment."
            : stage === "preparing"
              ? "Please wait while we check your checkout details."
              : "Please keep this page open. We’re confirming your order.")}
      </p>
      {addressReview?.suggestedAddress && (
        <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left text-sm">
          <p className="font-semibold">Suggested shipping address</p>
          <p className="mt-2">{addressReview.suggestedAddress.line1}</p>
          {addressReview.suggestedAddress.line2 && (
            <p>{addressReview.suggestedAddress.line2}</p>
          )}
          <p>
            {addressReview.suggestedAddress.city}, {addressReview.suggestedAddress.state}{" "}
            {addressReview.suggestedAddress.postalCode}
          </p>
          {onAcceptAddress && (
            <button
              type="button"
              onClick={onAcceptAddress}
              className="mt-4 w-full rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white"
            >
              Use suggested address
            </button>
          )}
        </div>
      )}
      {error && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-6 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white"
        >
          Return to checkout
        </button>
      )}
    </dialog>
  );
}
