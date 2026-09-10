import { Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode, RefObject } from "react";

import {
  BillingAddressFields,
  type CheckoutBillingAddressForm,
} from "@/components/checkout/BillingAddressFields";
import { CheckoutField } from "@/components/checkout/CheckoutField";
import { CheckoutCollapse } from "@/components/checkout/CheckoutCollapse";
import { PaymentCardBrands } from "@/components/checkout/PaymentCardBrands";
import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";

type SelectedPaymentMethod = "card" | "cashAppPay" | "afterpay";

export function CheckoutPaymentPanel({
  selectedMethod,
  cardBrand,
  cardErrors,
  cashAppCanPay,
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
  cardBrand?: string | null;
  cardErrors?: Record<string, string>;
  cashAppCanPay?: boolean;
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
        className="mt-4"
        role="radiogroup"
        aria-label="Payment method"
        onKeyDown={(event) => {
          if (
            !(event.target instanceof HTMLButtonElement) ||
            event.target.getAttribute("role") !== "radio"
          ) {
            return;
          }
          const methods = ["card", "cashAppPay", "afterpay"] as const;
          const direction =
            event.key === "ArrowDown" || event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowUp" || event.key === "ArrowLeft"
                ? -1
                : 0;
          if (!direction || isPaying) {
            return;
          }
          event.preventDefault();
          const next =
            methods[
              (methods.indexOf(selectedMethod) + direction + methods.length) %
                methods.length
            ];
          onSelectMethod(next);
          event.currentTarget
            .querySelector<HTMLButtonElement>(
              `[data-payment-method="${next}"] [role="radio"]`,
            )
            ?.focus();
        }}
      >
        {(["card", "cashAppPay", "afterpay"] as const).map((method) => {
          const selected = selectedMethod === method;
          const name =
            method === "card"
              ? "Credit card"
              : method === "cashAppPay"
                ? "Cash App Pay"
                : "Afterpay";
          return (
            <div
              key={method}
              data-payment-method={method}
              data-selected={selected}
              className="checkout-method"
            >
              <div className="flex min-h-[60px] items-center gap-3 px-4">
                <button
                  type="button"
                  role="radio"
                  disabled={isPaying}
                  aria-checked={selected}
                  aria-label={name}
                  aria-controls={`payment-${method}-content`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelectMethod(method)}
                  className="min-w-0 flex-1 self-stretch text-left text-base font-semibold"
                >
                  {name}
                </button>
                {method === "card" ? (
                  <PaymentCardBrands brand={cardBrand} />
                ) : (
                  <Image
                    src={`/images/payments/${method === "cashAppPay" ? "cash-app-pay" : "afterpay"}.svg`}
                    alt={name}
                    width={48}
                    height={30}
                    className="h-[30px] w-auto"
                    unoptimized
                  />
                )}
              </div>
              <CheckoutCollapse open={selected} id={`payment-${method}-content`}>
                {method === "card" ? (
                  <div className="grid gap-3 px-4 pb-4">
                    <div>
                      <div id="square-card-container" className="min-w-0" />
                      {cardErrors &&
                        Object.entries(cardErrors).map(([field, message]) => (
                          <p
                            key={field}
                            className="mt-1.5 text-sm leading-5 text-[#d92d39]"
                            aria-live="polite"
                          >
                            {message}
                          </p>
                        ))}
                    </div>
                    <CheckoutField errorMessage="Enter your name exactly as it is written on your card">
                      <input
                        required
                        disabled={!selected || isPaying}
                        aria-label="Name on card"
                        placeholder="Name on card"
                        autoComplete="cc-name"
                        maxLength={100}
                        ref={cardholderNameInput}
                        value={cardholderName}
                        onChange={(event) => onCardholderNameChange(event.target.value)}
                        className={CHECKOUT_INPUT_CLASS}
                      />
                    </CheckoutField>
                  </div>
                ) : (
                  <div className="px-4 pb-4">
                    <p className="text-sm leading-6">
                      Continue with {name} to approve your payment.
                    </p>
                    {selected && methodMessage && (
                      <p role="status" className="mt-2 text-sm text-zinc-600">
                        {methodMessage}
                      </p>
                    )}
                    {selected && onRetryMethod && (
                      <button
                        type="button"
                        onClick={onRetryMethod}
                        disabled={isPaying}
                        className="mt-2 text-sm underline"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </CheckoutCollapse>
            </div>
          );
        })}
      </div>
      <div id="square-afterpay-container" hidden />
      <div ref={billingFields} className="mt-8 grid gap-3">
        <h3 className="text-xl font-semibold">Billing address</h3>
        {fulfillment === "ship" && (
          <div className="rounded-xl border border-[#dedede]">
            {([true, false] as const).map((same) => (
              <label
                key={String(same)}
                className={`flex cursor-pointer items-center gap-3 px-4 py-4 text-sm transition-colors duration-200 motion-reduce:transition-none first:rounded-t-xl first:border-b first:border-[#dedede] last:rounded-b-xl ${sameAsShipping === same ? "bg-[#f5faff]" : "bg-white"}`}
              >
                <input
                  type="radio"
                  name="payment-billing"
                  checked={sameAsShipping === same}
                  disabled={isPaying}
                  onChange={() => onSameAsShippingChange(same)}
                  className="h-4 w-4 accent-[#1773b0]"
                />
                {same ? "Same as shipping address" : "Use a different billing address"}
              </label>
            ))}
          </div>
        )}
        <CheckoutCollapse open={showSeparateBilling}>
          <BillingAddressFields
            value={billingAddress}
            onChange={onBillingAddressChange}
            disabled={isPaying || !showSeparateBilling}
          />
        </CheckoutCollapse>
      </div>

      {securityChallenge}
      <div
        hidden={
          selectedMethod !== "cashAppPay" ||
          !cashAppPayReady ||
          !(cashAppCanPay ?? !payDisabled)
        }
        className="mt-5"
      >
        <div
          id="square-cash-app-pay-container"
          inert={
            selectedMethod !== "cashAppPay" ||
            !cashAppPayReady ||
            !(cashAppCanPay ?? !payDisabled)
          }
          aria-disabled={
            selectedMethod !== "cashAppPay" ||
            !cashAppPayReady ||
            !(cashAppCanPay ?? !payDisabled)
          }
        />
      </div>
      {selectedMethod !== "cashAppPay" ||
      !cashAppPayReady ||
      !(cashAppCanPay ?? !payDisabled) ? (
        <button
          type="submit"
          disabled={payDisabled}
          onClick={(event) => {
            event.preventDefault();
            onPay();
          }}
          aria-busy={selectedMethod === "afterpay" && !afterpayReady}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-950 px-6 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isPaying ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : selectedMethod === "cashAppPay" ? (
            "Continue with Cash App Pay"
          ) : (
            payLabel
          )}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-amber-800">
          {error}
        </p>
      ) : null}
      <nav
        aria-label="Checkout policies"
        className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-zinc-300 pt-4 text-sm"
      >
        <Link href="/refunds" className="text-sky-700 underline">
          Refund policy
        </Link>
        <Link href="/shipping" className="text-sky-700 underline">
          Shipping
        </Link>
        <Link href="/privacy" className="text-sky-700 underline">
          Privacy policy
        </Link>
        <Link href="/terms" className="text-sky-700 underline">
          Terms of service
        </Link>
        <Link href="/contact" className="text-sky-700 underline">
          Contact
        </Link>
      </nav>
    </section>
  );
}
