import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, MapPin, Package, PackageCheck, Search } from "lucide-react";

import { CheckoutField } from "@/components/checkout/CheckoutField";
import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";
import { CheckoutHelpTooltip } from "@/components/checkout/CheckoutHelpTooltip";
import { PICKUP_HOURS, PICKUP_LOCATION_SUMMARY } from "@/config/pickup";
import type { CheckoutAddressForm } from "@/lib/checkout/checkout-page-data";
import { US_STATE_OPTIONS } from "@/components/checkout/us-state-options";

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
  const [names, setNames] = useState(() => ({
    source: address.name,
    ...splitName(address.name),
  }));
  if (names.source !== address.name) {
    setNames({ source: address.name, ...splitName(address.name) });
  }
  const { firstName, lastName } = names;
  const fields = useRef<HTMLDivElement>(null);
  const previousHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = fields.current;
    if (
      element &&
      previousHeight.current !== null &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      element.animate(
        [
          { height: `${previousHeight.current}px` },
          { height: `${element.scrollHeight}px` },
        ],
        { duration: 200, easing: "ease" },
      );
    }
    previousHeight.current = null;
  }, [fulfillment]);
  function updateName(first: string, last: string) {
    const source = fullName(first, last);
    setNames({ source, firstName: first, lastName: last });
    onAddressChange("name", source);
  }

  return (
    <fieldset className="order-3 mt-8">
      <legend className="text-xl font-semibold">Delivery</legend>
      <div className="mt-4 grid grid-cols-2 rounded-xl bg-[#e8e8e8] p-1">
        {(["ship", "pickup"] as const).map((method) => (
          <button
            key={method}
            type="button"
            aria-pressed={fulfillment === method}
            onClick={() => {
              previousHeight.current =
                fields.current?.getBoundingClientRect().height ?? null;
              onFulfillmentChange(method);
            }}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-base font-medium transition-colors duration-200 motion-reduce:transition-none ${
              fulfillment === method ? "bg-white text-black shadow-sm" : "text-zinc-600"
            }`}
          >
            {method === "ship" ? (
              <Package className="h-4 w-4" aria-hidden="true" />
            ) : (
              <MapPin className="h-4 w-4" aria-hidden="true" />
            )}
            {method === "ship" ? "Ship" : "Pickup"}
          </button>
        ))}
      </div>

      <div
        ref={fields}
        key={fulfillment}
        className="checkout-reveal mt-5 grid gap-[10px]"
      >
        {fulfillment === "ship" ? (
          <label className="relative flex h-12 flex-col justify-center rounded-xl border border-[#dedede] bg-white px-3">
            <span className="text-xs leading-3 text-[#737373]">Country/Region</span>
            <select
              aria-label="Country/Region"
              autoComplete="shipping country"
              value="US"
              disabled
              className="w-full appearance-none bg-transparent pr-7 text-base leading-5 text-zinc-950 outline-none disabled:opacity-100"
            >
              <option value="US">United States</option>
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#737373]"
            />
          </label>
        ) : null}

        <div className="grid gap-[10px] sm:grid-cols-2">
          <div>
            <span className="sr-only">First name</span>
            <CheckoutField errorMessage="Enter a first name">
              <input
                required
                maxLength={50}
                aria-label="First name"
                placeholder="First name"
                autoComplete="shipping given-name"
                value={firstName}
                onChange={(event) => updateName(event.target.value, lastName)}
                className={CHECKOUT_INPUT_CLASS}
              />
            </CheckoutField>
          </div>
          <div>
            <span className="sr-only">Last name</span>
            <CheckoutField errorMessage="Enter a last name">
              <input
                required
                maxLength={50}
                aria-label="Last name"
                placeholder="Last name"
                autoComplete="shipping family-name"
                value={lastName}
                onChange={(event) => updateName(firstName, event.target.value)}
                className={CHECKOUT_INPUT_CLASS}
              />
            </CheckoutField>
          </div>
        </div>

        {fulfillment === "ship" ? (
          <>
            <div className="relative">
              <span className="sr-only">Address</span>
              <CheckoutField errorMessage="Enter an address">
                <input
                  required
                  maxLength={120}
                  aria-label="Address"
                  placeholder="Address"
                  autoComplete="shipping street-address"
                  value={address.line1}
                  onChange={(event) => onAddressChange("line1", event.target.value)}
                  className={`${CHECKOUT_INPUT_CLASS} pr-10`}
                />
                <Search
                  role="img"
                  aria-label="Search address"
                  className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#737373]"
                />
              </CheckoutField>
            </div>
            <div>
              <span className="sr-only">Apartment, suite, etc. (optional)</span>
              <CheckoutField errorMessage="Check the apartment or suite">
                <input
                  maxLength={120}
                  aria-label="Apartment, suite, etc. (optional)"
                  placeholder="Apartment, suite, etc. (optional)"
                  autoComplete="shipping address-line2"
                  value={address.line2}
                  onChange={(event) => onAddressChange("line2", event.target.value)}
                  className={CHECKOUT_INPUT_CLASS}
                />
              </CheckoutField>
            </div>
            <div className="grid gap-[10px] sm:grid-cols-3">
              <div>
                <span className="sr-only">City</span>
                <CheckoutField errorMessage="Enter a city">
                  <input
                    required
                    maxLength={80}
                    aria-label="City"
                    placeholder="City"
                    autoComplete="shipping address-level2"
                    value={address.city}
                    onChange={(event) => onAddressChange("city", event.target.value)}
                    className={CHECKOUT_INPUT_CLASS}
                  />
                </CheckoutField>
              </div>
              <div className="relative">
                {address.state ? (
                  <span className="pointer-events-none absolute left-3 top-1.5 z-10 text-xs leading-3 text-[#737373]">
                    State
                  </span>
                ) : (
                  <span className="sr-only">State</span>
                )}
                <CheckoutField errorMessage="Select a state">
                  <select
                    required
                    aria-label="State"
                    autoComplete="shipping address-level1"
                    value={address.state}
                    onChange={(event) => onAddressChange("state", event.target.value)}
                    className={`${CHECKOUT_INPUT_CLASS} appearance-none pr-8 ${address.state ? "pt-3" : "text-[#737373]"}`}
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
                </CheckoutField>
              </div>
              <div>
                <span className="sr-only">ZIP code</span>
                <CheckoutField errorMessage="Enter a valid ZIP / postal code">
                  <input
                    required
                    pattern="\d{5}(-\d{4})?"
                    inputMode="numeric"
                    maxLength={10}
                    aria-label="ZIP code"
                    placeholder="ZIP code"
                    autoComplete="shipping postal-code"
                    value={address.postalCode}
                    onChange={(event) =>
                      onAddressChange("postalCode", event.target.value)
                    }
                    className={CHECKOUT_INPUT_CLASS}
                  />
                </CheckoutField>
              </div>
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

        <div className="relative">
          <CheckoutField errorMessage="Enter a valid phone number">
            <input
              required
              type="tel"
              maxLength={30}
              aria-label="Phone"
              placeholder="Phone"
              autoComplete="tel"
              value={address.phone}
              onChange={(event) => onAddressChange("phone", event.target.value)}
              className={`${CHECKOUT_INPUT_CLASS} pr-10`}
            />
            <CheckoutHelpTooltip label="Phone help">
              In case we need to contact you about your order
            </CheckoutHelpTooltip>
          </CheckoutField>
        </div>
      </div>
    </fieldset>
  );
}
