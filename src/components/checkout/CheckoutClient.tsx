"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Loader2, LockKeyhole } from "lucide-react";

import { useCart } from "@/components/cart/CartProvider";
import { useSession } from "@/contexts/SessionContext";
import {
  getOrCreateCheckoutDeviceSessionId,
  getOrCreateCheckoutIdempotencyKey,
  storeGuestOrderAccess,
} from "@/lib/checkout/client-session";
import { setGuestShippingAddress } from "@/lib/checkout/guest-shipping-address";
import { clearIdempotencyKeyFromStorage } from "@/lib/checkout/idempotency";
import { isSquareHostedUrl } from "@/lib/square/payment-links";

type Fulfillment = "ship" | "pickup";

type Address = {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
};

const EMPTY_ADDRESS: Address = {
  name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
};

const formatPrice = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

export function CheckoutClient() {
  const { items, total, isReady } = useCart();
  const { user } = useSession();
  const [fulfillment, setFulfillment] = useState<Fulfillment>("ship");
  const [email, setEmail] = useState(user?.email ?? "");
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkoutItems = useMemo(
    () =>
      items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    [items],
  );

  const updateAddress = (field: keyof Address, value: string) => {
    setAddress((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (items.length === 0 || isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const shippingAddress =
      fulfillment === "ship"
        ? {
            ...address,
            phone: address.phone.trim() || null,
            line2: address.line2.trim() || null,
            state: address.state.trim().toUpperCase(),
            postalCode: address.postalCode.trim(),
            country: "US" as const,
          }
        : null;
    const buyerEmail = (user?.email ?? email).trim().toLowerCase();
    const cartFingerprint = JSON.stringify({
      items: checkoutItems,
      fulfillment,
      buyerEmail,
      shippingAddress,
    });

    try {
      if (shippingAddress) {
        setGuestShippingAddress(shippingAddress);
      }

      const response = await fetch("/api/checkout/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: checkoutItems,
          fulfillment,
          buyerEmail,
          shippingAddress,
          idempotencyKey: getOrCreateCheckoutIdempotencyKey(cartFingerprint),
          deviceSessionId: getOrCreateCheckoutDeviceSessionId(),
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 409) {
          clearIdempotencyKeyFromStorage();
        }
        throw new Error(data?.error || "Unable to start checkout");
      }
      if (
        typeof data?.orderId !== "string" ||
        typeof data?.url !== "string" ||
        !isSquareHostedUrl(data.url)
      ) {
        throw new Error("Checkout returned an invalid payment link");
      }

      if (typeof data.guestAccessToken === "string" && data.guestAccessToken) {
        storeGuestOrderAccess(data.orderId, data.guestAccessToken);
      }
      window.location.assign(data.url);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Unable to start checkout",
      );
      setIsSubmitting(false);
    }
  };

  if (!isReady) {
    return (
      <div className="flex min-h-[32rem] items-center justify-center bg-[var(--storefront-surface)]">
        <Loader2
          className="h-8 w-8 animate-spin text-zinc-700"
          aria-label="Loading cart"
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex min-h-[32rem] max-w-xl flex-col items-center justify-center px-5 text-center text-black">
        <h1 className="text-3xl uppercase">Your cart is empty</h1>
        <Link
          className="mt-6 bg-black px-8 py-4 text-sm uppercase text-white"
          href="/store"
        >
          Return to store
        </Link>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--storefront-surface)] px-5 py-12 text-black sm:px-8">
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]"
      >
        <section>
          <h1 className="text-3xl font-normal uppercase">Checkout</h1>
          <p className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
            <LockKeyhole className="h-4 w-4" /> Card details are entered securely on
            Square.
          </p>

          <fieldset className="mt-10">
            <legend className="text-sm font-medium uppercase">Delivery method</legend>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["ship", "pickup"] as const).map((method) => (
                <label key={method} className="border border-zinc-300 bg-white p-4">
                  <input
                    type="radio"
                    name="fulfillment"
                    value={method}
                    checked={fulfillment === method}
                    onChange={() => setFulfillment(method)}
                  />
                  <span className="ml-2 capitalize">
                    {method === "ship" ? "Ship" : "Local pickup"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-8 block text-sm font-medium uppercase">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={user?.email ?? email}
              disabled={Boolean(user)}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full border border-zinc-300 bg-white px-4 py-3 normal-case disabled:bg-zinc-100"
            />
          </label>

          {fulfillment === "ship" && (
            <fieldset className="mt-8 grid grid-cols-2 gap-4">
              <legend className="col-span-2 text-sm font-medium uppercase">
                Shipping address
              </legend>
              {(
                [
                  ["name", "Full name", "name"],
                  ["phone", "Phone (optional)", "tel"],
                  ["line1", "Address", "address-line1"],
                  ["line2", "Apartment, suite (optional)", "address-line2"],
                  ["city", "City", "address-level2"],
                  ["state", "State (2 letters)", "address-level1"],
                  ["postalCode", "ZIP code", "postal-code"],
                ] as const
              ).map(([field, label, autoComplete]) => (
                <label
                  key={field}
                  className={
                    field === "line1" || field === "line2"
                      ? "col-span-2 text-sm"
                      : "text-sm"
                  }
                >
                  {label}
                  <input
                    value={address[field]}
                    required={!(["phone", "line2"] as string[]).includes(field)}
                    autoComplete={autoComplete}
                    maxLength={field === "state" ? 2 : undefined}
                    onChange={(event) => updateAddress(field, event.target.value)}
                    className="mt-2 w-full border border-zinc-300 bg-white px-4 py-3"
                  />
                </label>
              ))}
            </fieldset>
          )}
        </section>

        <aside className="border border-zinc-300 bg-white p-6 lg:sticky lg:top-8">
          <h2 className="text-lg font-medium uppercase">Order summary</h2>
          <div className="mt-5 space-y-4 border-b border-zinc-200 pb-5">
            {items.map((item) => (
              <div
                key={`${item.productId}-${item.variantId}`}
                className="flex justify-between gap-4 text-sm"
              >
                <span>
                  {item.titleDisplay} × {item.quantity}
                </span>
                <span>{formatPrice(item.priceCents * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-between font-medium">
            <span>Subtotal</span>
            <span>{formatPrice(total)}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Square calculates authoritative tax. Shipping uses the configured store rate.
          </p>
          {error && (
            <p className="mt-4 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 flex w-full items-center justify-center bg-black px-6 py-4 text-sm font-medium uppercase text-white disabled:cursor-wait disabled:bg-zinc-500"
          >
            {isSubmitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              "Continue to Square"
            )}
          </button>
          <Link
            href="/cart"
            className="mt-4 block text-center text-sm underline underline-offset-4"
          >
            Return to cart
          </Link>
        </aside>
      </form>
    </main>
  );
}
