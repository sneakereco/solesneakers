"use client";

import { useState } from "react";
import { z } from "zod";

import {
  BillingAddressFields,
  type CheckoutBillingAddressForm,
} from "@/components/checkout/BillingAddressFields";
import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";
import {
  checkoutBillingAddressSchema,
  checkoutPickupContactSchema,
  checkoutShippingAddressSchema,
  type CheckoutBillingAddress,
  type CheckoutPickupContact,
} from "@/lib/checkout/checkout-request";
import type { CheckoutPaymentAddress } from "@/components/checkout/SquarePaymentMethods";

export const checkoutEmailSchema = z.string().trim().toLowerCase().email().max(254);
export type WalletDetails = {
  buyerEmail: string;
  billingAddress: CheckoutBillingAddress;
  pickupContact: CheckoutPickupContact | null;
  shippingAddress: CheckoutPaymentAddress | null;
};
export type WalletDetailsReview = {
  buyerEmail: string;
  billingAddress: CheckoutBillingAddressForm;
  pickupContact: CheckoutPickupContact | null;
  needsBilling: boolean;
  shippingAddress?:
    | (Omit<CheckoutPaymentAddress, "country"> & { country: string })
    | null;
};

export function CheckoutWalletDetails({
  initial,
  onContinue,
}: {
  initial: WalletDetailsReview;
  onContinue(value: WalletDetails): void;
}) {
  const [email, setEmail] = useState(initial.buyerEmail);
  const [billing, setBilling] = useState(initial.billingAddress);
  const [pickup, setPickup] = useState(initial.pickupContact);
  const [shipping, setShipping] = useState(initial.shippingAddress ?? null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-5 space-y-3 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        const parsedEmail = checkoutEmailSchema.safeParse(email);
        const parsedBilling = checkoutBillingAddressSchema.safeParse({
          ...billing,
          phone: billing.phone || null,
          line2: billing.line2 || null,
        });
        const parsedPickup = checkoutPickupContactSchema.nullable().safeParse(pickup);
        const parsedShipping = checkoutShippingAddressSchema
          .nullable()
          .safeParse(shipping);
        if (
          !parsedEmail.success ||
          !parsedBilling.success ||
          !parsedPickup.success ||
          !parsedShipping.success
        ) {
          setError("Check your contact and billing details to continue.");
          return;
        }
        onContinue({
          buyerEmail: parsedEmail.data,
          billingAddress: parsedBilling.data,
          pickupContact: parsedPickup.data,
          shippingAddress: parsedShipping.data
            ? { ...parsedShipping.data, line2: parsedShipping.data.line2 ?? null }
            : null,
        });
      }}
    >
      {!checkoutEmailSchema.safeParse(initial.buyerEmail).success && (
        <label className="block text-sm">
          Email
          <input
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            className={CHECKOUT_INPUT_CLASS}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
      )}
      {pickup &&
        !checkoutPickupContactSchema.shape.name.safeParse(initial.pickupContact?.name)
          .success && (
          <label className="block text-sm">
            Pickup name
            <input
              required
              maxLength={100}
              autoComplete="name"
              className={CHECKOUT_INPUT_CLASS}
              value={pickup.name}
              onChange={(event) => setPickup({ ...pickup, name: event.target.value })}
            />
          </label>
        )}
      {pickup &&
        !checkoutPickupContactSchema.shape.phone.safeParse(initial.pickupContact?.phone)
          .success && (
          <label className="block text-sm">
            Pickup phone
            <input
              type="tel"
              required
              minLength={7}
              maxLength={30}
              autoComplete="tel"
              className={CHECKOUT_INPUT_CLASS}
              value={pickup.phone}
              onChange={(event) => setPickup({ ...pickup, phone: event.target.value })}
            />
          </label>
        )}
      {initial.needsBilling && (
        <BillingAddressFields
          value={billing}
          onChange={(field, value) =>
            setBilling((current) => ({ ...current, [field]: value }))
          }
        />
      )}
      {shipping &&
        (
          [
            ["name", "Shipping name", 100],
            ["phone", "Shipping phone", 30],
          ] as const
        )
          .filter(
            ([field]) =>
              !checkoutShippingAddressSchema.shape[field].safeParse(
                initial.shippingAddress?.[field],
              ).success,
          )
          .map(([field, label, maxLength]) => (
            <label key={field} className="block text-sm">
              {label}
              <input
                required
                type={field === "phone" ? "tel" : "text"}
                maxLength={maxLength}
                className={CHECKOUT_INPUT_CLASS}
                value={shipping[field] ?? ""}
                onChange={(event) =>
                  setShipping({ ...shipping, [field]: event.target.value })
                }
              />
            </label>
          ))}
      {error && (
        <p role="alert" className="text-sm text-amber-800">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="w-full rounded-xl bg-zinc-950 px-5 py-3 font-medium text-white"
      >
        Continue
      </button>
    </form>
  );
}
