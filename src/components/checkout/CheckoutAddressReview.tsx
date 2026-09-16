import { useState } from "react";

import { checkoutShippingAddressSchema } from "@/lib/checkout/checkout-request";
import type {
  ShippingAddress,
  ShippingAddressValidationError,
} from "@/lib/checkout/shipping-address-validation";
import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";

export function CheckoutAddressReview({
  review,
  onContinue,
}: {
  review: ShippingAddressValidationError;
  onContinue(address: ShippingAddress, confirmation?: string, override?: boolean): void;
}) {
  const [error, setError] = useState("");
  if (!review.suggestedAddress) {
    return (
      <form
        className="mt-5 grid gap-3 text-left"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const parsed = checkoutShippingAddressSchema.safeParse({
            ...review.enteredAddress,
            ...Object.fromEntries(data),
            line2: data.get("line2") || null,
          });
          if (!parsed.success) {
            setError("Enter a complete US shipping address.");
            return;
          }
          onContinue(parsed.data);
        }}
      >
        {(
          [
            ["line1", "Street address", 100],
            ["line2", "Apartment, suite, etc.", 50],
            ["city", "City", 64],
            ["state", "State", 2],
            ["postalCode", "ZIP code", 10],
          ] as const
        ).map(([field, label, maxLength]) => (
          <label key={field} className="text-sm">
            {label}
            <input
              className={CHECKOUT_INPUT_CLASS}
              name={field}
              required={field !== "line2"}
              maxLength={maxLength}
              defaultValue={review.enteredAddress[field] ?? ""}
            />
          </label>
        ))}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white"
        >
          Save and continue
        </button>
      </form>
    );
  }
  const address = review.suggestedAddress;
  const entered = review.enteredAddress;
  return (
    <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left text-sm">
      <p className="font-semibold">Suggested shipping address</p>
      <p className="mt-2">{address.line1}</p>
      {address.line2 && <p>{address.line2}</p>}
      <p>
        {address.city}, {address.state} {address.postalCode}
      </p>
      <button
        type="button"
        onClick={() => onContinue(address, review.shippingConfirmation)}
        className="mt-4 w-full rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white"
      >
        Accept suggested address
      </button>
      <div className="mt-4 border-t border-zinc-200 pt-4">
        <p className="font-semibold">Address you entered</p>
        <p className="mt-2">{entered.line1}</p>
        {entered.line2 && <p>{entered.line2}</p>}
        <p>
          {entered.city}, {entered.state} {entered.postalCode}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onContinue(entered, review.enteredShippingConfirmation, true)}
        className="mt-3 w-full rounded-lg border border-zinc-300 px-5 py-3 font-medium"
      >
        Continue with address I entered
      </button>
    </div>
  );
}
