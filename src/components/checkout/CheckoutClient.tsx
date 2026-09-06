"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Loader2, LockKeyhole } from "lucide-react";

import { useCart } from "@/components/cart/CartProvider";
import { useSession } from "@/contexts/SessionContext";
import {
  getOrCreateCheckoutDeviceSessionId,
  getOrCreateCheckoutIdempotencyKey,
  storeGuestOrderAccess,
} from "@/lib/checkout/client-session";
import { clearIdempotencyKeyFromStorage } from "@/lib/checkout/idempotency";
import { isSquareHostedUrl } from "@/lib/square/payment-links";

type Fulfillment = "ship" | "pickup";

export function CheckoutClient() {
  const { items, isReady } = useCart();
  const { user } = useSession();
  const [email, setEmail] = useState(user?.email ?? "");
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (items.length === 0 || isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const fulfillment: Fulfillment =
      submitter instanceof HTMLButtonElement && submitter.value === "pickup"
        ? "pickup"
        : "ship";
    const buyerEmail = (user?.email ?? email).trim().toLowerCase();
    const cartFingerprint = JSON.stringify({
      items: checkoutItems,
      fulfillment,
      buyerEmail,
      shippingAddress: null,
    });

    try {
      const response = await fetch("/api/checkout/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: checkoutItems,
          fulfillment,
          buyerEmail,
          shippingAddress: null,
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
    <form
      onSubmit={(event) => void submit(event)}
      className="mt-6 border-t border-zinc-200 pt-6"
    >
      <p className="flex items-center gap-2 text-xs text-zinc-500">
        <LockKeyhole className="h-4 w-4" /> Address and payment details are entered on
        Square.
      </p>
      <label className="mt-4 block text-xs font-medium uppercase">
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
      {error && (
        <p className="mt-4 text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 grid gap-3">
        <button
          type="submit"
          name="fulfillment"
          value="ship"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center bg-zinc-950 px-6 py-4 text-sm font-medium uppercase text-white disabled:cursor-wait disabled:bg-zinc-500"
        >
          {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Ship to me"}
        </button>
        <button
          type="submit"
          name="fulfillment"
          value="pickup"
          disabled={isSubmitting}
          className="w-full border border-zinc-950 bg-white px-6 py-4 text-sm font-medium uppercase text-zinc-950 disabled:cursor-wait disabled:text-zinc-500"
        >
          Local pickup
        </button>
      </div>
    </form>
  );
}
