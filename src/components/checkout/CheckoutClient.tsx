"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { useCart } from "@/components/cart/CartProvider";
import { CheckoutContactSection } from "@/components/checkout/CheckoutContactSection";
import { CheckoutDeliverySection } from "@/components/checkout/CheckoutDeliverySection";
import { CheckoutHeader } from "@/components/checkout/CheckoutHeader";
import { CheckoutPaymentDialog } from "@/components/checkout/CheckoutPaymentDialog";
import {
  CheckoutOrderSummary,
  type CheckoutQuoteState,
} from "@/components/checkout/CheckoutOrderSummary";
import {
  SquarePaymentMethods,
  type CheckoutPreparationContext,
  type CheckoutPaymentAddress,
  type PaymentMethod,
  type PreparedCheckout,
  type WalletCheckoutContext,
  type WalletShippingDestination,
} from "@/components/checkout/SquarePaymentMethods";
import {
  getOrCreateCheckoutDeviceSessionId,
  getOrCreateCheckoutIdempotencyKey,
  storeGuestOrderAccess,
} from "@/lib/checkout/client-session";
import type {
  CheckoutBillingAddress,
  CheckoutQuoteRequest,
  CheckoutQuoteResponse,
  PaymentPermitRequest,
} from "@/lib/checkout/checkout-request";
import { checkoutShippingAddressSchema } from "@/lib/checkout/checkout-request";
import type {
  CheckoutAddressForm,
  CheckoutPageData,
} from "@/lib/checkout/checkout-page-data";
import {
  ShippingAddressValidationError,
  shippingAddressKey,
  type ShippingAddress,
} from "@/lib/checkout/shipping-address-validation";
import { clearIdempotencyKeyFromStorage } from "@/lib/checkout/idempotency";

type Fulfillment = "ship" | "pickup";

function normalizedAddress(address: CheckoutAddressForm): CheckoutPaymentAddress | null {
  const parsed = checkoutShippingAddressSchema.safeParse({
    ...address,
    line2: address.line2.trim() || null,
  });
  return parsed.success ? { ...parsed.data, line2: parsed.data.line2 ?? null } : null;
}

async function requestCheckoutQuote(
  input: CheckoutQuoteRequest,
  signal?: AbortSignal,
): Promise<CheckoutQuoteResponse> {
  const response = await fetch("/api/checkout/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "Unable to calculate checkout totals");
  }
  return data as CheckoutQuoteResponse;
}

type CheckoutPreparePayload = {
  items: CheckoutQuoteRequest["items"];
  fulfillment: Fulfillment;
  paymentMethod: PaymentPermitRequest["method"];
  buyerEmail: string;
  shippingAddress: CheckoutPaymentAddress | null;
  billingAddress: CheckoutBillingAddress | null;
  quoteFingerprint: string;
  idempotencyKey: string;
  deviceSessionId: string;
};

export function buildCheckoutPreparePayload(
  input: CheckoutPreparePayload,
): CheckoutPreparePayload {
  return input;
}

export function CheckoutClient({ initialData }: { initialData: CheckoutPageData }) {
  const { items, isReady, clearCart } = useCart();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [email, setEmail] = useState(initialData.customer.email);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("ship");
  const [address, setAddress] = useState(initialData.customer.address);
  const [quoteState, setQuoteState] = useState<CheckoutQuoteState>({
    status: "loading",
  });
  const [resolvedQuoteKey, setResolvedQuoteKey] = useState<string | null>(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const requestSequence = useRef(0);
  const acceptedShippingCorrection = useRef<{
    entered: ShippingAddress;
    suggested: ShippingAddress;
  } | null>(null);

  function acceptShippingAddress(entered: ShippingAddress, suggested: ShippingAddress) {
    acceptedShippingCorrection.current = { entered, suggested };
    setAddress({ ...suggested, line2: suggested.line2 ?? "" });
    setQuoteRevision((value) => value + 1);
  }

  const walletQuote = useRef<{ key: string; quote: CheckoutQuoteResponse } | null>(null);

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
    if (walletQuote.current?.key === quoteKey) {
      walletQuote.current = null;
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
      void requestCheckoutQuote(
        {
          items: checkoutItems,
          fulfillment,
          shippingAddress,
        },
        controller.signal,
      )
        .then((quote) => {
          if (requestSequence.current === requestId) {
            setResolvedQuoteKey(quoteKey);
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

  const quoteReady = quoteState.status === "ready" && resolvedQuoteKey === quoteKey;
  const exactQuote =
    quoteReady && quoteState.quote.completeness === "exact" ? quoteState.quote : null;
  const currentQuote = quoteState.quote ?? null;

  function updateAddress(field: keyof CheckoutAddressForm, value: string) {
    acceptedShippingCorrection.current = null;
    setAddress((current) => ({ ...current, [field]: value }));
  }

  async function quoteWalletShippingDestination(nextAddress: WalletShippingDestination) {
    const correction = acceptedShippingCorrection.current;
    if (
      correction &&
      nextAddress.country === correction.entered.country &&
      nextAddress.state === correction.entered.state &&
      nextAddress.postalCode === correction.entered.postalCode
    ) {
      nextAddress = {
        country: correction.suggested.country,
        state: correction.suggested.state,
        postalCode: correction.suggested.postalCode,
      };
    }
    const nextQuote = await requestCheckoutQuote({
      items: checkoutItems,
      fulfillment: "ship",
      shippingAddress: nextAddress,
    });
    if (nextQuote.completeness !== "exact") {
      throw new Error("Unable to calculate shipping for this destination.");
    }
    return { quote: nextQuote };
  }

  async function resolveWalletShippingContact(
    nextAddress: CheckoutPaymentAddress,
    walletEmail?: string,
  ): Promise<WalletCheckoutContext> {
    const correction = acceptedShippingCorrection.current;
    if (
      correction &&
      shippingAddressKey(nextAddress) === shippingAddressKey(correction.entered)
    ) {
      nextAddress = {
        ...correction.suggested,
        name: nextAddress.name,
        phone: nextAddress.phone,
        line2: correction.suggested.line2 ?? null,
      };
    } else if (
      correction &&
      shippingAddressKey(nextAddress) !== shippingAddressKey(correction.suggested)
    ) {
      acceptedShippingCorrection.current = null;
    }
    const nextQuote = await requestCheckoutQuote({
      items: checkoutItems,
      fulfillment: "ship",
      shippingAddress: nextAddress,
    });
    if (nextQuote.completeness !== "exact") {
      throw new Error("Unable to calculate an exact total for this address.");
    }
    const nextAddressForm = {
      ...nextAddress,
      line2: nextAddress.line2 ?? "",
    };
    const nextQuoteKey = JSON.stringify({
      items: checkoutItems,
      fulfillment: "ship",
      shippingAddress: nextAddress,
      quoteRevision,
    });
    walletQuote.current = { key: nextQuoteKey, quote: nextQuote };
    setAddress(nextAddressForm);
    if (walletEmail) {
      setEmail(walletEmail);
    }
    setResolvedQuoteKey(nextQuoteKey);
    setQuoteState({ status: "ready", quote: nextQuote });
    return {
      quote: nextQuote,
      shippingAddress: nextAddress,
      buyerEmail: walletEmail,
    };
  }

  async function prepare(
    method: PaymentMethod,
    context?: CheckoutPreparationContext,
  ): Promise<PreparedCheckout> {
    const buyerEmail = (context?.buyerEmail ?? email).trim().toLowerCase();
    const selectedQuote = context?.quote ?? exactQuote;
    const selectedShippingAddress = context?.shippingAddress ?? shippingAddress;
    const selectedBillingAddress = context?.billingAddress ?? null;
    if (!buyerEmail || !selectedQuote) {
      throw new Error("Complete your contact and delivery details before paying.");
    }
    if (fulfillment === "ship" && !selectedShippingAddress) {
      throw new Error("Enter a complete US shipping address before paying.");
    }

    const cartFingerprint = JSON.stringify({
      items: checkoutItems,
      fulfillment,
      buyerEmail,
      paymentMethod: method,
      shippingAddress: selectedShippingAddress,
      billingAddress: selectedBillingAddress,
      quoteFingerprint: selectedQuote.quoteFingerprint,
    });
    const deviceSessionId = getOrCreateCheckoutDeviceSessionId();
    const response = await fetch("/api/checkout/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildCheckoutPreparePayload({
          items: checkoutItems,
          fulfillment,
          paymentMethod: method,
          buyerEmail,
          shippingAddress: selectedShippingAddress,
          billingAddress: selectedBillingAddress,
          quoteFingerprint: selectedQuote.quoteFingerprint,
          idempotencyKey: getOrCreateCheckoutIdempotencyKey(cartFingerprint),
          deviceSessionId,
        }),
      ),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (
        selectedShippingAddress &&
        [
          "SHIPPING_ADDRESS_INVALID",
          "SHIPPING_ADDRESS_SUGGESTION",
          "SHIPPING_ADDRESS_UNAVAILABLE",
        ].includes(data?.code)
      ) {
        const suggestion = checkoutShippingAddressSchema.safeParse(
          data?.suggestedAddress,
        );
        throw new ShippingAddressValidationError(
          data.error || "Check your shipping address before continuing.",
          selectedShippingAddress,
          suggestion.success ? suggestion.data : undefined,
        );
      }
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

  if (isRedirecting) {
    return <CheckoutPaymentDialog open />;
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
    <div data-checkout className="min-h-screen bg-[#f3f3f3]">
      <CheckoutHeader />
      <main className="grid min-h-[calc(100vh-7rem)] w-full grid-cols-1 bg-[#f3f3f3] text-zinc-950 lg:grid-cols-[53.4%_46.6%]">
        <CheckoutOrderSummary
          className="order-1 lg:order-2"
          items={items}
          quoteState={quoteState}
        />

        <section className="order-2 px-5 py-10 sm:px-8 lg:order-1 lg:ml-auto lg:w-full lg:max-w-[36.25rem] lg:px-10 lg:py-16">
          <h1 className="sr-only">Checkout</h1>
          <div className="flex flex-col">
            <SquarePaymentMethods
              paymentConfig={initialData.paymentConfig}
              quote={currentQuote}
              quoteReady={quoteReady}
              fulfillment={fulfillment}
              buyerEmail={email}
              shippingAddress={shippingAddress}
              isGuest={initialData.isGuest}
              quoteWalletShippingDestination={quoteWalletShippingDestination}
              resolveWalletShippingContact={resolveWalletShippingContact}
              prepare={prepare}
              onAcceptShippingAddress={acceptShippingAddress}
              clearCart={() => {
                setIsRedirecting(true);
                clearIdempotencyKeyFromStorage();
                clearCart();
              }}
            >
              <CheckoutContactSection
                email={email}
                isGuest={initialData.isGuest}
                onEmailChange={setEmail}
              />

              <CheckoutDeliverySection
                fulfillment={fulfillment}
                address={address}
                onFulfillmentChange={setFulfillment}
                onAddressChange={updateAddress}
              />
            </SquarePaymentMethods>
          </div>
        </section>
      </main>
    </div>
  );
}
