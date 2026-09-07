"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, PackageCheck, Truck } from "lucide-react";

import { useCart } from "@/components/cart/CartProvider";
import {
  CheckoutOrderSummary,
  type CheckoutQuoteState,
} from "@/components/checkout/CheckoutOrderSummary";
import {
  SquarePaymentMethods,
  type CheckoutPaymentAddress,
  type PreparedCheckout,
} from "@/components/checkout/SquarePaymentMethods";
import { PICKUP_HOURS, PICKUP_LOCATION_SUMMARY } from "@/config/pickup";
import {
  getOrCreateCheckoutDeviceSessionId,
  getOrCreateCheckoutIdempotencyKey,
  storeGuestOrderAccess,
} from "@/lib/checkout/client-session";
import type { CheckoutQuoteResponse } from "@/lib/checkout/checkout-request";
import { checkoutShippingAddressSchema } from "@/lib/checkout/checkout-request";
import type {
  CheckoutAddressForm,
  CheckoutPageData,
} from "@/lib/checkout/checkout-page-data";
import { clearIdempotencyKeyFromStorage } from "@/lib/checkout/idempotency";

type Fulfillment = "ship" | "pickup";
const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 disabled:bg-zinc-100";

function normalizedAddress(address: CheckoutAddressForm): CheckoutPaymentAddress | null {
  const parsed = checkoutShippingAddressSchema.safeParse({
    ...address,
    line2: address.line2.trim() || null,
  });
  return parsed.success ? { ...parsed.data, line2: parsed.data.line2 ?? null } : null;
}

export function CheckoutClient({ initialData }: { initialData: CheckoutPageData }) {
  const { items, isReady, clearCart } = useCart();
  const [email, setEmail] = useState(initialData.customer.email);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("ship");
  const [address, setAddress] = useState(initialData.customer.address);
  const [quoteState, setQuoteState] = useState<CheckoutQuoteState>({
    status: "loading",
  });
  const [quoteRevision, setQuoteRevision] = useState(0);
  const requestSequence = useRef(0);

  const checkoutItems = useMemo(
    () =>
      items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    [items],
  );
  const shippingAddress = useMemo(
    () => (fulfillment === "ship" ? normalizedAddress(address) : null),
    [address, fulfillment],
  );
  const quoteKey = JSON.stringify({
    items: checkoutItems,
    fulfillment,
    shippingAddress,
    quoteRevision,
  });

  useEffect(() => {
    if (!isReady || checkoutItems.length === 0) {
      return;
    }
    const requestId = ++requestSequence.current;
    const controller = new AbortController();
    const delay = fulfillment === "ship" && shippingAddress ? 300 : 0;
    const timer = window.setTimeout(() => {
      setQuoteState((current) => ({
        status: "loading",
        quote: current.quote,
      }));
      void fetch("/api/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          items: checkoutItems,
          fulfillment,
          shippingAddress,
        }),
      })
        .then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(data?.error || "Unable to calculate checkout totals");
          }
          return data as CheckoutQuoteResponse;
        })
        .then((quote) => {
          if (requestSequence.current === requestId) {
            setQuoteState({ status: "ready", quote });
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestSequence.current !== requestId) {
            return;
          }
          setQuoteState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to calculate checkout totals",
          });
        });
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // quoteKey is the canonical trigger and prevents stale address responses.
  }, [isReady, quoteKey]);

  const exactQuote =
    quoteState.status === "ready" && quoteState.quote.completeness === "exact"
      ? quoteState.quote
      : null;

  function updateAddress(field: keyof CheckoutAddressForm, value: string) {
    setAddress((current) => ({ ...current, [field]: value }));
  }

  async function prepare(): Promise<PreparedCheckout> {
    const buyerEmail = email.trim().toLowerCase();
    if (!buyerEmail || !exactQuote) {
      throw new Error("Complete your contact and delivery details before paying.");
    }
    if (fulfillment === "ship" && !shippingAddress) {
      throw new Error("Enter a complete US shipping address before paying.");
    }

    const cartFingerprint = JSON.stringify({
      items: checkoutItems,
      fulfillment,
      buyerEmail,
      shippingAddress,
      quoteFingerprint: exactQuote.quoteFingerprint,
    });
    const deviceSessionId = getOrCreateCheckoutDeviceSessionId();
    const response = await fetch("/api/checkout/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: checkoutItems,
        fulfillment,
        buyerEmail,
        shippingAddress,
        quoteFingerprint: exactQuote.quoteFingerprint,
        idempotencyKey: getOrCreateCheckoutIdempotencyKey(cartFingerprint),
        deviceSessionId,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 409) {
        clearIdempotencyKeyFromStorage();
        setQuoteRevision((value) => value + 1);
      }
      throw new Error(data?.error || "Unable to prepare checkout");
    }
    if (
      typeof data?.orderId !== "string" ||
      typeof data?.totals?.subtotalCents !== "number" ||
      typeof data?.totals?.shippingCents !== "number" ||
      typeof data?.totals?.taxCents !== "number" ||
      typeof data?.totals?.totalCents !== "number"
    ) {
      throw new Error("Checkout returned invalid payment details");
    }
    if (typeof data.guestAccessToken === "string" && data.guestAccessToken) {
      storeGuestOrderAccess(data.orderId, data.guestAccessToken);
    }
    return {
      orderId: data.orderId,
      guestAccessToken: data.guestAccessToken,
      deviceSessionId,
      totals: data.totals,
    };
  }

  if (!isReady) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading cart" />
      </div>
    );
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl grid-cols-1 bg-white text-black lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.78fr)]">
      <section className="order-2 px-5 py-8 sm:px-8 lg:order-1 lg:px-12 lg:py-12">
        <h1 className="mb-8 text-3xl font-semibold">Checkout</h1>
        <form className="flex flex-col" onSubmit={(event) => event.preventDefault()}>
          <SquarePaymentMethods
            paymentConfig={initialData.paymentConfig}
            exactQuote={exactQuote}
            fulfillment={fulfillment}
            buyerEmail={email}
            shippingAddress={shippingAddress}
            isGuest={initialData.isGuest}
            prepare={prepare}
            clearCart={() => {
              clearIdempotencyKeyFromStorage();
              clearCart();
            }}
          >
            <section className="order-2" aria-labelledby="contact-heading">
              <h2 id="contact-heading" className="text-2xl font-semibold">
                Contact
              </h2>
              <label className="mt-4 block text-sm text-zinc-700">
                Email
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  disabled={!initialData.isGuest}
                  onChange={(event) => setEmail(event.target.value)}
                  className={`${inputClass} mt-2`}
                />
              </label>
            </section>

            <fieldset className="order-3 mt-8">
              <legend className="text-2xl font-semibold">Delivery</legend>
              <div className="mt-4 grid grid-cols-2 rounded-xl bg-zinc-100 p-1">
                {(["ship", "pickup"] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={fulfillment === method}
                    onClick={() => setFulfillment(method)}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-medium ${
                      fulfillment === method
                        ? "bg-white text-black shadow-sm"
                        : "text-zinc-600"
                    }`}
                  >
                    {method === "ship" ? (
                      <Truck className="h-4 w-4" />
                    ) : (
                      <MapPin className="h-4 w-4" />
                    )}
                    {method === "ship" ? "Shipping" : "Local pickup"}
                  </button>
                ))}
              </div>

              <div className="mt-5 grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-zinc-700">
                    Full name
                    <input
                      required
                      autoComplete="name"
                      value={address.name}
                      onChange={(event) => updateAddress("name", event.target.value)}
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                  <label className="text-sm text-zinc-700">
                    Phone
                    <input
                      required
                      type="tel"
                      autoComplete="tel"
                      value={address.phone}
                      onChange={(event) => updateAddress("phone", event.target.value)}
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                </div>

                {fulfillment === "ship" ? (
                  <>
                    <label className="text-sm text-zinc-700">
                      Address
                      <input
                        required
                        autoComplete="shipping street-address"
                        value={address.line1}
                        onChange={(event) => updateAddress("line1", event.target.value)}
                        className={`${inputClass} mt-2`}
                      />
                    </label>
                    <label className="text-sm text-zinc-700">
                      Apartment, suite, etc. (optional)
                      <input
                        autoComplete="shipping address-line2"
                        value={address.line2}
                        onChange={(event) => updateAddress("line2", event.target.value)}
                        className={`${inputClass} mt-2`}
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-[1fr_8rem_9rem]">
                      <label className="text-sm text-zinc-700">
                        City
                        <input
                          required
                          autoComplete="shipping address-level2"
                          value={address.city}
                          onChange={(event) => updateAddress("city", event.target.value)}
                          className={`${inputClass} mt-2`}
                        />
                      </label>
                      <label className="text-sm text-zinc-700">
                        State
                        <input
                          required
                          maxLength={2}
                          autoComplete="shipping address-level1"
                          value={address.state}
                          onChange={(event) =>
                            updateAddress("state", event.target.value.toUpperCase())
                          }
                          className={`${inputClass} mt-2 uppercase`}
                        />
                      </label>
                      <label className="text-sm text-zinc-700">
                        ZIP code
                        <input
                          required
                          autoComplete="shipping postal-code"
                          value={address.postalCode}
                          onChange={(event) =>
                            updateAddress("postalCode", event.target.value)
                          }
                          className={`${inputClass} mt-2`}
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <div className="flex gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <PackageCheck className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-medium">Pickup in {PICKUP_LOCATION_SUMMARY}</p>
                      <p className="mt-1 text-sm text-zinc-600">{PICKUP_HOURS}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Appointment details are sent after your order is confirmed.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </fieldset>
          </SquarePaymentMethods>
        </form>
      </section>

      <CheckoutOrderSummary
        className="order-1 lg:order-2"
        items={items}
        quoteState={quoteState}
      />
    </main>
  );
}
