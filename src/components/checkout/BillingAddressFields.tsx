import { ChevronDown, CircleHelp, Search } from "lucide-react";

import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";
import { US_STATE_OPTIONS } from "@/components/checkout/us-state-options";

export type CheckoutBillingAddressForm = {
  givenName: string;
  familyName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export const EMPTY_BILLING_ADDRESS: CheckoutBillingAddressForm = {
  givenName: "",
  familyName: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

export function BillingAddressFields({
  value,
  onChange,
  disabled = false,
}: {
  value: CheckoutBillingAddressForm;
  onChange(field: keyof CheckoutBillingAddressForm, value: string): void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-[10px]">
      <label className="relative flex h-12 flex-col justify-center rounded-xl border border-[#dedede] bg-white px-3">
        <span className="text-xs leading-3 text-[#737373]">Country/Region</span>
        <select
          required
          autoComplete="billing country"
          value={value.country}
          disabled={disabled}
          onChange={(event) => onChange("country", event.target.value)}
          className="w-full appearance-none bg-transparent pr-7 text-base leading-5 text-zinc-950 outline-none focus-visible:outline-none disabled:opacity-100"
        >
          <option value="US">United States</option>
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#737373]"
        />
      </label>
      <div className="grid gap-[10px] sm:grid-cols-2">
        <input
          required
          aria-label="Billing first name"
          placeholder="First name"
          autoComplete="billing given-name"
          value={value.givenName}
          disabled={disabled}
          onChange={(event) => onChange("givenName", event.target.value)}
          className={CHECKOUT_INPUT_CLASS}
        />
        <input
          required
          aria-label="Billing last name"
          placeholder="Last name"
          autoComplete="billing family-name"
          value={value.familyName}
          disabled={disabled}
          onChange={(event) => onChange("familyName", event.target.value)}
          className={CHECKOUT_INPUT_CLASS}
        />
      </div>
      <label className="relative">
        <span className="sr-only">Billing address</span>
        <input
          required
          aria-label="Billing address"
          placeholder="Address"
          autoComplete="billing address-line1"
          value={value.line1}
          disabled={disabled}
          onChange={(event) => onChange("line1", event.target.value)}
          className={`${CHECKOUT_INPUT_CLASS} pr-10`}
        />
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#737373]"
        />
      </label>
      <input
        aria-label="Billing apartment, suite, etc."
        placeholder="Apartment, suite, etc. (optional)"
        autoComplete="billing address-line2"
        value={value.line2}
        disabled={disabled}
        onChange={(event) => onChange("line2", event.target.value)}
        className={CHECKOUT_INPUT_CLASS}
      />
      <div className="grid gap-[10px] sm:grid-cols-3">
        <input
          required
          aria-label="Billing city"
          placeholder="City"
          autoComplete="billing address-level2"
          value={value.city}
          disabled={disabled}
          onChange={(event) => onChange("city", event.target.value)}
          className={CHECKOUT_INPUT_CLASS}
        />
        <label className="relative">
          {value.state ? (
            <span className="pointer-events-none absolute left-3 top-1.5 z-10 text-xs leading-3 text-[#737373]">
              State
            </span>
          ) : (
            <span className="sr-only">Billing state</span>
          )}
          <select
            required
            aria-label="Billing state"
            autoComplete="billing address-level1"
            value={value.state}
            disabled={disabled}
            onChange={(event) => onChange("state", event.target.value)}
            className={`${CHECKOUT_INPUT_CLASS} appearance-none pr-8 ${value.state ? "pt-3" : "text-[#737373]"}`}
          >
            <option value="" disabled>
              State
            </option>
            {US_STATE_OPTIONS.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#737373]"
          />
        </label>
        <input
          required
          aria-label="Billing ZIP code"
          placeholder="ZIP code"
          autoComplete="billing postal-code"
          value={value.postalCode}
          disabled={disabled}
          onChange={(event) => onChange("postalCode", event.target.value)}
          className={CHECKOUT_INPUT_CLASS}
        />
      </div>
      <label className="relative">
        <span className="sr-only">Billing phone</span>
        <input
          type="tel"
          aria-label="Billing phone"
          placeholder="Phone (optional)"
          autoComplete="billing tel"
          value={value.phone}
          disabled={disabled}
          onChange={(event) => onChange("phone", event.target.value)}
          className={`${CHECKOUT_INPUT_CLASS} pr-10`}
        />
        <CircleHelp
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#737373]"
        />
      </label>
    </div>
  );
}
