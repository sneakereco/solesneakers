"use client";

import Image from "next/image";
import { useMemo, useState, type FormEvent } from "react";
import { Loader2, LockKeyhole } from "lucide-react";

import { useCart } from "@/components/cart/CartProvider";
import { SquarePaymentMethods } from "@/components/checkout/SquarePaymentMethods";
import { useSession } from "@/contexts/SessionContext";
import {
  getOrCreateCheckoutDeviceSessionId,
  getOrCreateCheckoutIdempotencyKey,
  storeGuestOrderAccess,
} from "@/lib/checkout/client-session";
import { clearIdempotencyKeyFromStorage } from "@/lib/checkout/idempotency";
import type { SquareEnvironment } from "@/lib/square/web-payments";

type Fulfillment = "ship" | "pickup";
type Address = {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: "US";
};
type Prepared = {
  orderId: string;
  guestAccessToken?: string;
  totals: {
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
  };
  paymentConfig: {
    applicationId: string;
    locationId: string;
    environment: SquareEnvironment;
  };
  buyerEmail: string;
  shippingAddress: (Omit<Address, "line2"> & { line2: string | null }) | null;
  deviceSessionId: string;
};

const EMPTY_ADDRESS: Address = {
  name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}

export function CheckoutClient() {
  const { items, isReady, clearCart } = useCart();
  const { user } = useSession();
  const [email, setEmail] = useState(user?.email ?? "");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("ship");
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
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
    setPrepared(null);
  };

  const prepare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (items.length === 0 || isSubmitting) {
      return;
    }
    setError(null);
    setIsSubmitting(true);

    const buyerEmail = (user?.email ?? email).trim().toLowerCase();
    const shippingAddress =
      fulfillment === "ship" ? { ...address, line2: address.line2.trim() || null } : null;
    const cartFingerprint = JSON.stringify({
      items: checkoutItems,
      fulfillment,
      buyerEmail,
      shippingAddress,
    });
    const deviceSessionId = getOrCreateCheckoutDeviceSessionId();

    try {
      const response = await fetch("/api/checkout/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: checkoutItems,
          fulfillment,
          buyerEmail,
          shippingAddress,
          idempotencyKey: getOrCreateCheckoutIdempotencyKey(cartFingerprint),
          deviceSessionId,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) {
          clearIdempotencyKeyFromStorage();
        }
        throw new Error(data?.error || "Unable to prepare checkout");
      }
      if (
        typeof data?.orderId !== "string" ||
        typeof data?.totals?.totalCents !== "number" ||
        typeof data?.paymentConfig?.applicationId !== "string" ||
        typeof data?.paymentConfig?.locationId !== "string" ||
        !["sandbox", "production"].includes(data?.paymentConfig?.environment)
      ) {
        throw new Error("Checkout returned invalid payment details");
      }
      if (typeof data.guestAccessToken === "string" && data.guestAccessToken) {
        storeGuestOrderAccess(data.orderId, data.guestAccessToken);
      }
      setPrepared({
        orderId: data.orderId,
        guestAccessToken: data.guestAccessToken,
        totals: data.totals,
        paymentConfig: data.paymentConfig,
        buyerEmail,
        shippingAddress,
        deviceSessionId,
      });
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Unable to prepare checkout",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isReady) {
    return (
      <div className="flex min-h-24 items-center justify-center">
        <Loader2
          className="h-8 w-8 animate-spin text-zinc-700"
          aria-label="Loading cart"
        />
      </div>
    );
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 border-t border-zinc-200 pt-6">
      <p className="flex items-center gap-2 text-xs text-zinc-600">
        <LockKeyhole className="h-4 w-4" /> Guest checkout supports Card and Afterpay.
      </p>

      <div className="mt-4 space-y-3" aria-label="Checkout items">
        {items.map((item) => (
          <div
            key={`${item.productId}-${item.variantId}`}
            className="flex items-center gap-3"
          >
            <Image
              src={item.imageUrl}
              alt={item.titleDisplay}
              width={56}
              height={56}
              className="h-14 w-14 object-contain mix-blend-multiply"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium uppercase">
                {item.titleDisplay}
              </p>
              <p className="text-xs text-zinc-500">
                Size {item.sizeLabel} · Qty {item.quantity}
              </p>
            </div>
            <span className="text-xs font-medium">
              {formatPrice(item.priceCents * item.quantity)}
            </span>
          </div>
        ))}
      </div>

      {!prepared ? (
        <form onSubmit={(event) => void prepare(event)}>
          <div className="mt-5 grid grid-cols-2 gap-2" aria-label="Fulfillment method">
            {(["ship", "pickup"] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => {
                  setFulfillment(method);
                  setPrepared(null);
                }}
                className={
                  fulfillment === method
                    ? "border border-zinc-950 bg-zinc-950 px-3 py-3 text-xs font-medium uppercase text-white"
                    : "border border-zinc-300 bg-white px-3 py-3 text-xs font-medium uppercase text-zinc-800"
                }
              >
                {method === "ship" ? "Shipping" : "Local pickup"}
              </button>
            ))}
          </div>
          <label className="mt-4 block text-xs font-medium uppercase">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={user?.email ?? email}
              disabled={Boolean(user)}
              onChange={(event) => {
                setEmail(event.target.value);
                setPrepared(null);
              }}
              className="mt-2 w-full border border-zinc-300 bg-white px-3 py-3 normal-case disabled:bg-zinc-100"
            />
          </label>
          {fulfillment === "ship" && (
            <fieldset className="mt-4 grid gap-3">
              <legend className="text-xs font-medium uppercase">Shipping address</legend>
              <input
                required
                autoComplete="shipping name"
                placeholder="Full name"
                value={address.name}
                onChange={(event) => updateAddress("name", event.target.value)}
                className="border border-zinc-300 px-3 py-3 text-sm"
              />
              <input
                required
                type="tel"
                autoComplete="shipping tel"
                placeholder="Phone"
                value={address.phone}
                onChange={(event) => updateAddress("phone", event.target.value)}
                className="border border-zinc-300 px-3 py-3 text-sm"
              />
              <input
                required
                autoComplete="shipping street-address"
                placeholder="Street address"
                value={address.line1}
                onChange={(event) => updateAddress("line1", event.target.value)}
                className="border border-zinc-300 px-3 py-3 text-sm"
              />
              <input
                autoComplete="shipping address-line2"
                placeholder="Apartment, suite, etc. (optional)"
                value={address.line2}
                onChange={(event) => updateAddress("line2", event.target.value)}
                className="border border-zinc-300 px-3 py-3 text-sm"
              />
              <input
                required
                autoComplete="shipping address-level2"
                placeholder="City"
                value={address.city}
                onChange={(event) => updateAddress("city", event.target.value)}
                className="border border-zinc-300 px-3 py-3 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  maxLength={2}
                  autoComplete="shipping address-level1"
                  placeholder="State"
                  value={address.state}
                  onChange={(event) =>
                    updateAddress("state", event.target.value.toUpperCase())
                  }
                  className="border border-zinc-300 px-3 py-3 text-sm uppercase"
                />
                <input
                  required
                  autoComplete="shipping postal-code"
                  placeholder="ZIP code"
                  value={address.postalCode}
                  onChange={(event) => updateAddress("postalCode", event.target.value)}
                  className="border border-zinc-300 px-3 py-3 text-sm"
                />
              </div>
            </fieldset>
          )}
          {error && (
            <p className="mt-4 text-sm text-amber-800" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-5 flex w-full items-center justify-center bg-zinc-950 px-6 py-4 text-sm font-medium uppercase text-white disabled:bg-zinc-400"
          >
            {isSubmitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              "Continue to secure payment"
            )}
          </button>
        </form>
      ) : (
        <>
          <dl className="mt-5 space-y-2 border-y border-zinc-200 py-4 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatPrice(prepared.totals.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Shipping</dt>
              <dd>{formatPrice(prepared.totals.shippingCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Tax</dt>
              <dd>{formatPrice(prepared.totals.taxCents)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Total</dt>
              <dd>{formatPrice(prepared.totals.totalCents)}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => setPrepared(null)}
            className="mt-3 text-xs underline underline-offset-4"
          >
            Edit delivery details
          </button>
          <SquarePaymentMethods
            checkout={prepared}
            deviceSessionId={prepared.deviceSessionId}
            buyerEmail={prepared.buyerEmail}
            shippingAddress={prepared.shippingAddress}
            isGuest={!user}
            clearCart={() => {
              clearIdempotencyKeyFromStorage();
              clearCart();
            }}
          />
        </>
      )}
    </div>
  );
}
