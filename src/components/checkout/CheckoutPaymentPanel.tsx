import { Loader2 } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import {
  BillingAddressFields,
  type CheckoutBillingAddressForm,
} from "@/components/checkout/BillingAddressFields";
import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";

type SelectedPaymentMethod = "card" | "afterpay";

export function CheckoutPaymentPanel({
  selectedMethod,
  afterpayReady,
  fulfillment,
  sameAsShipping,
  cardholderName,
  billingAddress,
  isPaying,
  payDisabled,
  payLabel,
  error,
  cardholderNameInput,
  billingFields,
  securityChallenge,
  onSelectMethod,
  onSameAsShippingChange,
  onCardholderNameChange,
  onBillingAddressChange,
  onPay,
}: {
  selectedMethod: SelectedPaymentMethod;
  afterpayReady: boolean;
  fulfillment: "ship" | "pickup";
  sameAsShipping: boolean;
  cardholderName: string;
  billingAddress: CheckoutBillingAddressForm;
  isPaying: boolean;
  payDisabled: boolean;
  payLabel: string;
  error: string | null;
  cardholderNameInput?: RefObject<HTMLInputElement | null>;
  billingFields?: RefObject<HTMLDivElement | null>;
  securityChallenge?: ReactNode;
  onSelectMethod(method: SelectedPaymentMethod): void;
  onSameAsShippingChange(value: boolean): void;
  onCardholderNameChange(value: string): void;
  onBillingAddressChange(field: keyof CheckoutBillingAddressForm, value: string): void;
  onPay(): void;
}) {
  const showSeparateBilling = fulfillment === "pickup" || !sameAsShipping;

  return (
    <section className="order-4 mt-8" aria-labelledby="payment-heading">
      <h2 id="payment-heading" className="text-2xl font-semibold">
        Payment
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        All transactions are secure and encrypted.
      </p>
      <div
        className="mt-4 overflow-hidden rounded-xl border border-zinc-300 bg-zinc-50"
        role="radiogroup"
        aria-label="Payment method"
      >
        <button
          type="button"
          role="radio"
          aria-checked={selectedMethod === "card"}
          onClick={() => onSelectMethod("card")}
          className={`flex w-full items-center gap-3 border-b px-4 py-4 text-left ${
            selectedMethod === "card"
              ? "border-sky-600 bg-sky-50 ring-1 ring-inset ring-sky-600"
              : "border-zinc-200 bg-white"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-5 w-5 rounded-full border-[6px] ${
              selectedMethod === "card"
                ? "border-sky-600 bg-white"
                : "border border-zinc-300 bg-white"
            }`}
          />
          <span className="font-semibold">Credit card</span>
        </button>

        <div hidden={selectedMethod !== "card"} className="grid gap-3 px-4 py-4">
          <div id="square-card-container" className="min-h-24 rounded bg-white" />
          <input
            required
            aria-label="Name on card"
            placeholder="Name on card"
            autoComplete="cc-name"
            ref={cardholderNameInput}
            value={cardholderName}
            onChange={(event) => onCardholderNameChange(event.target.value)}
            className={CHECKOUT_INPUT_CLASS}
          />
          {fulfillment === "ship" ? (
            <label className="flex items-center gap-3 py-1 text-sm font-medium">
              <input
                type="checkbox"
                checked={sameAsShipping}
                onChange={(event) => onSameAsShippingChange(event.target.checked)}
                className="h-5 w-5 rounded border-zinc-300 accent-sky-600 focus-visible:outline-none"
              />
              Use shipping address as billing address
            </label>
          ) : null}
          {showSeparateBilling ? (
            <div ref={billingFields} className="grid gap-4 pt-2">
              <h3 className="text-xl font-semibold">Billing address</h3>
              <BillingAddressFields
                value={billingAddress}
                onChange={onBillingAddressChange}
                disabled={isPaying}
              />
            </div>
          ) : null}
        </div>

        <button
          id="square-afterpay-container"
          type="button"
          role="radio"
          aria-checked={selectedMethod === "afterpay"}
          hidden={!afterpayReady}
          onClick={() => onSelectMethod("afterpay")}
          className={`flex w-full items-center justify-between gap-3 px-4 py-4 text-left ${
            selectedMethod === "afterpay"
              ? "bg-sky-50 ring-1 ring-inset ring-sky-600"
              : "bg-white"
          }`}
        >
          <span className="flex items-center gap-3 font-semibold">
            <span
              aria-hidden="true"
              className={`h-5 w-5 rounded-full border-[6px] ${
                selectedMethod === "afterpay"
                  ? "border-sky-600 bg-white"
                  : "border border-zinc-300 bg-white"
              }`}
            />
            Afterpay
          </span>
        </button>

        {selectedMethod === "afterpay" && afterpayReady ? (
          <div className="border-t border-zinc-200">
            <p className="px-4 py-5 text-center text-sm">
              You&apos;ll be redirected to Afterpay to complete your purchase.
            </p>
            <div
              ref={billingFields}
              className="grid gap-4 border-t border-zinc-200 px-4 py-5"
            >
              <h3 className="text-xl font-semibold">Billing address</h3>
              {fulfillment === "ship" ? (
                <div className="overflow-hidden rounded-xl border border-zinc-300">
                  <label className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-4 font-medium">
                    <input
                      type="radio"
                      name="afterpay-billing"
                      checked={sameAsShipping}
                      onChange={() => onSameAsShippingChange(true)}
                      className="h-5 w-5 accent-sky-600 focus-visible:outline-none"
                    />
                    Same as shipping address
                  </label>
                  <label className="flex items-center gap-3 bg-white px-4 py-4 font-medium">
                    <input
                      type="radio"
                      name="afterpay-billing"
                      checked={!sameAsShipping}
                      onChange={() => onSameAsShippingChange(false)}
                      className="h-5 w-5 accent-sky-600 focus-visible:outline-none"
                    />
                    Use a different billing address
                  </label>
                </div>
              ) : null}
              {showSeparateBilling ? (
                <BillingAddressFields
                  value={billingAddress}
                  onChange={onBillingAddressChange}
                  disabled={isPaying}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {securityChallenge}
      <button
        type="button"
        disabled={payDisabled}
        onClick={onPay}
        className="mt-5 flex w-full items-center justify-center rounded bg-zinc-950 px-6 py-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {isPaying ? <Loader2 className="h-5 w-5 animate-spin" /> : payLabel}
      </button>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-amber-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
