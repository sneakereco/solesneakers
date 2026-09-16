"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { CheckoutAddressReview } from "@/components/checkout/CheckoutAddressReview";
import type { ShippingAddress } from "@/lib/checkout/shipping-address-validation";
import type { ShippingAddressValidationError } from "@/lib/checkout/shipping-address-validation";

export function CheckoutPaymentDialog({
  open,
  error,
  onDismiss,
  stage = "processing",
  addressReview,
  onAcceptAddress,
  totalReview = null,
  onConfirmTotal,
  cashAppReapproval = false,
  walletReview,
}: {
  open: boolean;
  addressReview?: ShippingAddressValidationError | null;
  onAcceptAddress?: (address: ShippingAddress, confirmation?: string) => void;
  totalReview?: number | null;
  onConfirmTotal?: () => void;
  cashAppReapproval?: boolean;
  walletReview?: ReactNode;
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
        if (
          error ||
          addressReview ||
          totalReview !== null ||
          cashAppReapproval ||
          walletReview
        ) {
          onDismiss?.();
        }
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border-0 bg-white p-8 text-center text-zinc-900 shadow-xl backdrop:bg-black/50"
    >
      {!error &&
        !addressReview &&
        totalReview === null &&
        !cashAppReapproval &&
        !walletReview && (
          <div
            aria-hidden="true"
            className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 motion-reduce:animate-none"
          />
        )}
      <h2 id="checkout-payment-title" className="text-xl font-semibold">
        {walletReview
          ? "Complete your checkout details"
          : addressReview
            ? "Review your shipping address"
            : totalReview !== null
              ? "Review your updated total"
              : cashAppReapproval
                ? "Confirm in Cash App"
                : error
                  ? "Payment could not be completed"
                  : stage === "afterpay"
                    ? "Opening Afterpay"
                    : stage === "preparing"
                      ? "Preparing checkout"
                      : "Processing your payment"}
      </h2>
      {addressReview && (
        <p className="mt-3 text-sm font-semibold">
          You have not been charged. Check your shipping address to continue.
        </p>
      )}
      <p
        id="checkout-payment-description"
        role={error ? "alert" : "status"}
        className="mt-3 text-sm text-zinc-600"
      >
        {(walletReview
          ? "Your wallet left out a few details. Complete them below to finish this payment."
          : addressReview
            ? "Confirm or edit the address below to continue this payment."
            : totalReview !== null
              ? "The address changed your total. Confirm the amount before continuing. You have not been charged."
              : cashAppReapproval
                ? "Approve the updated total with Cash App to finish your order."
                : error) ||
          (stage === "afterpay"
            ? "Continue in the Afterpay window to review and approve your payment."
            : stage === "preparing"
              ? "Please wait while we check your checkout details."
              : "Please keep this page open. We’re confirming your order.")}
      </p>
      {walletReview}
      {addressReview && onAcceptAddress && (
        <CheckoutAddressReview
          key={JSON.stringify(addressReview.enteredAddress)}
          review={addressReview}
          onContinue={onAcceptAddress}
        />
      )}
      {totalReview !== null && (
        <button
          type="button"
          onClick={onConfirmTotal}
          className="mt-5 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white"
        >
          Confirm ${(totalReview / 100).toFixed(2)} and continue
        </button>
      )}
      {cashAppReapproval && <div id="cash-app-address-confirmation" className="mt-5" />}
      {(error ||
        addressReview ||
        totalReview !== null ||
        cashAppReapproval ||
        walletReview) && (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-6 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white"
        >
          {addressReview || totalReview !== null || cashAppReapproval || walletReview
            ? "Cancel checkout"
            : "Return to checkout"}
        </button>
      )}
    </dialog>
  );
}
