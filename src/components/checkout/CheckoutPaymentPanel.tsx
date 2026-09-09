import { Loader2 } from "lucide-react";
import Image from "next/image";
import type { ReactNode, RefObject } from "react";

import {
  BillingAddressFields,
  type CheckoutBillingAddressForm,
} from "@/components/checkout/BillingAddressFields";
import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";

type SelectedPaymentMethod = "card" | "cashAppPay" | "afterpay";

export function CheckoutPaymentPanel({
  selectedMethod,
  afterpayReady,
  cashAppPayReady,
  methodMessage,
  onRetryMethod,
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
  cashAppPayReady: boolean;
  methodMessage?: string | null;
  onRetryMethod?: () => void;
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
      <h2 id="payment-heading" className="text-xl font-semibold">
        Payment
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        All transactions are secure and encrypted.
      </p>
      <div
        className="mt-3 overflow-hidden rounded-xl border border-[#dedede] bg-[#f4f4f4]"
        role="radiogroup"
        aria-label="Payment method"
      >
        <button
          type="button"
          role="radio"
          disabled={isPaying}
          aria-checked={selectedMethod === "card"}
          onClick={() => onSelectMethod("card")}
          className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left ${
            selectedMethod === "card"
              ? "border-[#1878b9] bg-[#f2f7ff] ring-1 ring-inset ring-[#1878b9]"
              : "border-[#dedede] bg-white"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-4 w-4 rounded-full ${
              selectedMethod === "card"
                ? "border-[5px] border-[#1878b9] bg-white"
                : "border border-[#dedede] bg-white"
            }`}
          />
          <span className="font-semibold">Credit card</span>
        </button>

        <div
          hidden={selectedMethod !== "card"}
          className={`${selectedMethod === "card" ? "grid" : "hidden"} gap-[10px] bg-[#f4f4f4] p-3`}
        >
          <div id="square-card-container" className="min-h-24 rounded-xl bg-white" />
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
                className="checkout-checkbox h-5 w-5 focus-visible:outline-none"
              />
              Use shipping address as billing address
            </label>
          ) : null}
          {showSeparateBilling && selectedMethod === "card" ? (
            <div ref={billingFields} className="grid gap-3 pt-2">
              <h3 className="text-lg font-semibold">Billing address</h3>
              <BillingAddressFields
                value={billingAddress}
                onChange={onBillingAddressChange}
                disabled={isPaying}
              />
            </div>
          ) : null}
        </div>

        <button
          type="button"
          role="radio"
          disabled={isPaying}
          aria-checked={selectedMethod === "cashAppPay"}
          onClick={() => onSelectMethod("cashAppPay")}
          className={`flex w-full items-center gap-3 border-t border-[#dedede] px-4 py-3 text-left ${
            selectedMethod === "cashAppPay"
              ? "bg-[#f2f7ff] ring-1 ring-inset ring-[#1878b9]"
              : "bg-white"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-4 w-4 rounded-full ${
              selectedMethod === "cashAppPay"
                ? "border-[5px] border-[#1878b9] bg-white"
                : "border border-[#dedede] bg-white"
            }`}
          />
          <span className="font-semibold">Cash App Pay</span>
        </button>
        <div hidden={selectedMethod !== "cashAppPay"} className="p-3">
          <div
            id="square-cash-app-pay-container"
            inert={!cashAppPayReady || payDisabled}
            aria-disabled={!cashAppPayReady || payDisabled}
          />
        </div>

        <button
          type="button"
          role="radio"
          disabled={isPaying}
          aria-checked={selectedMethod === "afterpay"}
          aria-label="Afterpay"
          onClick={() => onSelectMethod("afterpay")}
          className={`flex w-full items-center justify-between gap-3 border-t border-[#dedede] px-4 py-3 text-left ${
            selectedMethod === "afterpay"
              ? "bg-[#f2f7ff] ring-1 ring-inset ring-[#1878b9]"
              : "bg-white"
          }`}
        >
          <span className="flex items-center gap-3 font-semibold">
            <span
              aria-hidden="true"
              className={`h-4 w-4 rounded-full ${
                selectedMethod === "afterpay"
                  ? "border-[5px] border-[#1878b9] bg-white"
                  : "border border-[#dedede] bg-white"
              }`}
            />
            Afterpay
          </span>
          <Image
            src="/images/payments/afterpay.svg"
            alt="Afterpay"
            width={48}
            height={30}
            className="h-6 w-auto"
            unoptimized
          />
        </button>

        <div id="square-afterpay-container" hidden />

        {selectedMethod === "afterpay" ? (
          <div className="border-t border-[#dedede] bg-[#f4f4f4]">
            <p className="px-4 py-4 text-center text-sm">
              Continue with Afterpay to complete your purchase in the Afterpay popup.
            </p>
          </div>
        ) : null}
      </div>

      {selectedMethod === "afterpay" ? (
        <div ref={billingFields} className="mt-8 grid gap-3">
          <h3 className="text-lg font-semibold">Billing address</h3>
          {fulfillment === "ship" ? (
            <div className="overflow-hidden rounded-xl border border-[#dedede]">
              <label className="flex items-center gap-3 border-b border-[#dedede] bg-[#f2f7ff] px-4 py-3 font-medium">
                <input
                  type="radio"
                  name="afterpay-billing"
                  checked={sameAsShipping}
                  onChange={() => onSameAsShippingChange(true)}
                  className="h-4 w-4 accent-[#1878b9] focus-visible:outline-none"
                />
                Same as shipping address
              </label>
              <label className="flex items-center gap-3 bg-white px-4 py-3 font-medium">
                <input
                  type="radio"
                  name="afterpay-billing"
                  checked={!sameAsShipping}
                  onChange={() => onSameAsShippingChange(false)}
                  className="h-4 w-4 accent-[#1878b9] focus-visible:outline-none"
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
      ) : null}

      {securityChallenge}
      {methodMessage ? (
        <p role="status" className="mt-4 text-sm text-zinc-600">
          {methodMessage}
        </p>
      ) : null}
      {onRetryMethod ? (
        <button
          type="button"
          onClick={onRetryMethod}
          disabled={isPaying}
          className="mt-3 text-sm underline"
        >
          Retry
        </button>
      ) : null}
      {selectedMethod !== "cashAppPay" ? (
        <button
          type="button"
          disabled={payDisabled || (selectedMethod === "afterpay" && !afterpayReady)}
          onClick={onPay}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 px-6 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isPaying ? <Loader2 className="h-5 w-5 animate-spin" /> : payLabel}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-amber-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
