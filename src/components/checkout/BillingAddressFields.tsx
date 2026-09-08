import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";

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
    <div className="grid gap-3">
      <label className="relative block rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs text-zinc-500">
        Country/Region
        <select
          required
          autoComplete="billing country"
          value={value.country}
          disabled={disabled}
          onChange={(event) => onChange("country", event.target.value)}
          className="block w-full appearance-none bg-transparent text-sm text-zinc-950 outline-none focus-visible:outline-none"
        >
          <option value="US">United States</option>
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
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
      <input
        required
        aria-label="Billing address"
        placeholder="Address"
        autoComplete="billing address-line1"
        value={value.line1}
        disabled={disabled}
        onChange={(event) => onChange("line1", event.target.value)}
        className={CHECKOUT_INPUT_CLASS}
      />
      <input
        aria-label="Billing apartment, suite, etc."
        placeholder="Apartment, suite, etc. (optional)"
        autoComplete="billing address-line2"
        value={value.line2}
        disabled={disabled}
        onChange={(event) => onChange("line2", event.target.value)}
        className={CHECKOUT_INPUT_CLASS}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_9rem]">
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
        <input
          required
          aria-label="Billing state"
          placeholder="State"
          maxLength={2}
          autoComplete="billing address-level1"
          value={value.state}
          disabled={disabled}
          onChange={(event) => onChange("state", event.target.value.toUpperCase())}
          className={`${CHECKOUT_INPUT_CLASS} uppercase`}
        />
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
      <input
        type="tel"
        aria-label="Billing phone"
        placeholder="Phone (optional)"
        autoComplete="billing tel"
        value={value.phone}
        disabled={disabled}
        onChange={(event) => onChange("phone", event.target.value)}
        className={CHECKOUT_INPUT_CLASS}
      />
    </div>
  );
}
