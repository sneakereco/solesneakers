import { MapPin, PackageCheck, Truck } from "lucide-react";

import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";
import { PICKUP_HOURS, PICKUP_LOCATION_SUMMARY } from "@/config/pickup";
import type { CheckoutAddressForm } from "@/lib/checkout/checkout-page-data";

type Fulfillment = "ship" | "pickup";

function splitName(name: string) {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

function fullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

export function CheckoutDeliverySection({
  fulfillment,
  address,
  onFulfillmentChange,
  onAddressChange,
}: {
  fulfillment: Fulfillment;
  address: CheckoutAddressForm;
  onFulfillmentChange(value: Fulfillment): void;
  onAddressChange(field: keyof CheckoutAddressForm, value: string): void;
}) {
  const { firstName, lastName } = splitName(address.name);

  return (
    <fieldset className="order-3 mt-8">
      <legend className="text-2xl font-semibold">Delivery</legend>
      <div className="mt-4 grid grid-cols-2 rounded-xl bg-zinc-100 p-1">
        {(["ship", "pickup"] as const).map((method) => (
          <button
            key={method}
            type="button"
            aria-pressed={fulfillment === method}
            onClick={() => onFulfillmentChange(method)}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-medium ${
              fulfillment === method ? "bg-white text-black shadow-sm" : "text-zinc-600"
            }`}
          >
            {method === "ship" ? (
              <Truck className="h-4 w-4" aria-hidden="true" />
            ) : (
              <MapPin className="h-4 w-4" aria-hidden="true" />
            )}
            {method === "ship" ? "Ship" : "Pickup"}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3">
        {fulfillment === "ship" ? (
          <label>
            <span className="sr-only">Country/Region</span>
            <select
              aria-label="Country/Region"
              autoComplete="shipping country"
              value="US"
              disabled
              className={`${CHECKOUT_INPUT_CLASS} disabled:bg-white disabled:text-zinc-950 disabled:opacity-100`}
            >
              <option value="US">United States</option>
            </select>
          </label>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="sr-only">First name</span>
            <input
              required
              aria-label="First name"
              placeholder="First name"
              autoComplete="shipping given-name"
              value={firstName}
              onChange={(event) =>
                onAddressChange("name", fullName(event.target.value, lastName))
              }
              className={CHECKOUT_INPUT_CLASS}
            />
          </label>
          <label>
            <span className="sr-only">Last name</span>
            <input
              required
              aria-label="Last name"
              placeholder="Last name"
              autoComplete="shipping family-name"
              value={lastName}
              onChange={(event) =>
                onAddressChange("name", fullName(firstName, event.target.value))
              }
              className={CHECKOUT_INPUT_CLASS}
            />
          </label>
        </div>

        {fulfillment === "ship" ? (
          <>
            <label>
              <span className="sr-only">Address</span>
              <input
                required
                aria-label="Address"
                placeholder="Address"
                autoComplete="shipping street-address"
                value={address.line1}
                onChange={(event) => onAddressChange("line1", event.target.value)}
                className={CHECKOUT_INPUT_CLASS}
              />
            </label>
            <label>
              <span className="sr-only">Apartment, suite, etc. (optional)</span>
              <input
                aria-label="Apartment, suite, etc. (optional)"
                placeholder="Apartment, suite, etc. (optional)"
                autoComplete="shipping address-line2"
                value={address.line2}
                onChange={(event) => onAddressChange("line2", event.target.value)}
                className={CHECKOUT_INPUT_CLASS}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem_9rem]">
              <label>
                <span className="sr-only">City</span>
                <input
                  required
                  aria-label="City"
                  placeholder="City"
                  autoComplete="shipping address-level2"
                  value={address.city}
                  onChange={(event) => onAddressChange("city", event.target.value)}
                  className={CHECKOUT_INPUT_CLASS}
                />
              </label>
              <label>
                <span className="sr-only">State</span>
                <input
                  required
                  aria-label="State"
                  placeholder="State"
                  maxLength={2}
                  autoComplete="shipping address-level1"
                  value={address.state}
                  onChange={(event) =>
                    onAddressChange("state", event.target.value.toUpperCase())
                  }
                  className={`${CHECKOUT_INPUT_CLASS} uppercase`}
                />
              </label>
              <label>
                <span className="sr-only">ZIP code</span>
                <input
                  required
                  aria-label="ZIP code"
                  placeholder="ZIP code"
                  autoComplete="shipping postal-code"
                  value={address.postalCode}
                  onChange={(event) => onAddressChange("postalCode", event.target.value)}
                  className={CHECKOUT_INPUT_CLASS}
                />
              </label>
            </div>
          </>
        ) : (
          <div className="flex gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <PackageCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Pickup in {PICKUP_LOCATION_SUMMARY}</p>
              <p className="mt-1 text-sm text-zinc-600">{PICKUP_HOURS}</p>
              <p className="mt-1 text-xs text-zinc-500">
                Appointment details are sent after your order is confirmed.
              </p>
            </div>
          </div>
        )}

        <label>
          <span className="sr-only">Phone</span>
          <input
            required
            type="tel"
            aria-label="Phone"
            placeholder="Phone"
            autoComplete="tel"
            value={address.phone}
            onChange={(event) => onAddressChange("phone", event.target.value)}
            className={CHECKOUT_INPUT_CLASS}
          />
        </label>
      </div>
    </fieldset>
  );
}
