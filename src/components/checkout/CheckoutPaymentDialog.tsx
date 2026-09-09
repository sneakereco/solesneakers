"use client";

import { useLayoutEffect, useRef } from "react";

export function CheckoutPaymentDialog({
  open,
  error,
  onDismiss,
}: {
  open: boolean;
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
        {error ? "Payment could not be completed" : "Processing your payment"}
      </h2>
      <p
        id="checkout-payment-description"
        role={error ? "alert" : "status"}
        className="mt-3 text-sm text-zinc-600"
      >
        {error || "Please keep this page open. We’re confirming your order."}
      </p>
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
