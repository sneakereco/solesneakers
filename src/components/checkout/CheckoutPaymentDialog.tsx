"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";

import { CheckoutAddressReview } from "@/components/checkout/CheckoutAddressReview";
import type { ShippingAddress } from "@/lib/checkout/shipping-address-validation";
import type { ShippingAddressValidationError } from "@/lib/checkout/shipping-address-validation";

type PaymentDialogProps = {
  open: boolean;
  providerActive?: boolean;
  loadingProvider?: "Afterpay" | "Cash App Pay" | null;
  addressReview?: ShippingAddressValidationError | null;
  onAcceptAddress?: (
    address: ShippingAddress,
    confirmation?: string,
    override?: boolean,
  ) => void;
  totalReview?: number | null;
  onConfirmTotal?: () => void;
  cashAppReapproval?: boolean;
  walletReview?: ReactNode;
  error?: string | null;
  onDismiss?: () => void;
};

const PaymentDialogContext = createContext<Dispatch<
  SetStateAction<PaymentDialogProps>
> | null>(null);

export function CheckoutPaymentProvider({ children }: { children: ReactNode }) {
  const [props, setProps] = useState<PaymentDialogProps>({ open: false });
  return (
    <PaymentDialogContext.Provider value={setProps}>
      {children}
      <PaymentDialogContent {...props} />
    </PaymentDialogContext.Provider>
  );
}

export function CheckoutPaymentDialog(props: PaymentDialogProps) {
  const setDialog = useContext(PaymentDialogContext);
  useLayoutEffect(() => {
    setDialog?.(props);
    // Keep the host mounted during route handoffs; the next screen owns its state.
  }, [setDialog, props]);
  return setDialog ? null : <PaymentDialogContent {...props} />;
}

function PaymentDialogContent({
  open,
  providerActive = false,
  loadingProvider = null,
  error,
  onDismiss,
  addressReview,
  onAcceptAddress,
  totalReview = null,
  onConfirmTotal,
  cashAppReapproval = false,
  walletReview,
}: PaymentDialogProps) {
  const showingProgress =
    !error &&
    !addressReview &&
    totalReview === null &&
    !cashAppReapproval &&
    !walletReview;
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Native provider challenges must be able to receive focus above our loader.
    if (element.open && (!open || element.matches(":modal") === providerActive)) {
      element.close();
    }
    if (open && !element.open) {
      if (providerActive) element.show();
      else element.showModal();
    }
  }, [open, providerActive]);

  return (
    <>
      {open && (
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-50 ${showingProgress ? "bg-[var(--storefront-surface)]" : "bg-black/50"}`}
          style={providerActive ? { pointerEvents: "none" } : undefined}
        />
      )}
      <dialog
        data-checkout
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
        className="fixed inset-0 z-[60] m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border-0 bg-white p-8 text-center text-zinc-900 shadow-xl backdrop:bg-transparent"
      >
        {showingProgress && (
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
                    : loadingProvider
                      ? `Loading ${loadingProvider}…`
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
              ? "Choose the shipping address to use for this payment."
              : totalReview !== null
                ? "The address changed your total. Confirm the amount before continuing. You have not been charged."
                : cashAppReapproval
                  ? "Approve the updated total with Cash App to finish your order."
                  : error) ||
            (loadingProvider
              ? `Complete your payment approval in ${loadingProvider}.`
              : "This may take a few seconds. Please keep this page open while we process your payment and confirm your order. Don't submit another payment.")}
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
    </>
  );
}
