"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/contexts/SessionContext";
import { CheckoutSkeleton } from "./CheckoutSkeletons";
import { withRequestDeadline } from "@/lib/http/request-deadline";

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
  CheckoutCartUnavailable,
  SquarePaymentMethods,
  type CheckoutPreparationContext,
  type CheckoutPaymentAddress,
  type PaymentMethod,
  type PreparedCheckout,
  type WalletCheckoutContext,
  type WalletShippingDestination,
} from "@/components/checkout/SquarePaymentMethods";
import {
  clearCheckoutAttempt,
  getOrCreateCheckoutDeviceSessionId,
  getOrCreateCheckoutIdempotencyKey,
  storeGuestOrderAccess,
} from "@/lib/checkout/client-session";
import type {
  CheckoutBillingAddress,
  CheckoutPickupContact,
  CheckoutQuoteRequest,
  CheckoutQuoteResponse,
  PaymentPermitRequest,
} from "@/lib/checkout/checkout-request";
import {
  checkoutPickupContactSchema,
  checkoutShippingAddressSchema,
} from "@/lib/checkout/checkout-request";
import type {
  CheckoutAddressForm,
  CheckoutPageData,
} from "@/lib/checkout/checkout-page-data";
import { ShippingAddressValidationError } from "@/lib/checkout/shipping-address-validation";
import { captureCheckoutStarted } from "@/lib/measurement/client";
import { hasUsableCheckout } from "@/lib/measurement/triggers";

type Fulfillment = "ship" | "pickup";

function normalizedAddress(address: CheckoutAddressForm): CheckoutPaymentAddress | null {
  const parsed = checkoutShippingAddressSchema.safeParse({
    ...address,
    line2: address.line2.trim() || null,
  });
  return parsed.success ? { ...parsed.data, line2: parsed.data.line2 ?? null } : null;
}

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function requestCheckoutQuote(
  input: CheckoutQuoteRequest,
  signal?: AbortSignal,
): Promise<CheckoutQuoteResponse> {
  return withRequestDeadline(async (requestSignal) => {
    const response = await fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: requestSignal,
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || "Unable to calculate checkout totals");
    }
    const totals = data?.totals;
    const exact =
      data?.completeness === "exact" &&
      isCents(totals?.taxCents) &&
      typeof data.quoteFingerprint === "string" &&
      data.quoteFingerprint.length > 0;
    const preliminary =
      data?.completeness === "preliminary" &&
      totals?.taxCents === null &&
      data.quoteFingerprint === null;
    if (
      (!exact && !preliminary) ||
      ![totals?.subtotalCents, totals?.shippingCents, totals?.totalCents].every(isCents)
    )
      throw Error("Unable to verify checkout totals.");
    return data as CheckoutQuoteResponse;
  }, signal);
}

type CheckoutPreparePayload = {
  items: CheckoutQuoteRequest["items"];
  fulfillment: Fulfillment;
  paymentMethod: PaymentPermitRequest["method"];
  buyerEmail: string;
  shippingAddress: CheckoutPaymentAddress | null;
  billingAddress: CheckoutBillingAddress | null;
  pickupContact?: CheckoutPickupContact | null;
  quoteFingerprint: string;
  shippingConfirmation?: string;
  shippingAddressOverride?: boolean;
  idempotencyKey: string;
  deviceSessionId: string;
};

export function buildCheckoutPreparePayload(
  input: CheckoutPreparePayload,
): CheckoutPreparePayload {
  return input;
}

export function CheckoutClient({ initialData }: { initialData: CheckoutPageData }) {
  const [activeData, setActiveData] = useState<CheckoutPageData | null>(null);
  const data = activeData ?? initialData;
  return (
    <CheckoutForm
      key={JSON.stringify([data.isGuest, data.customer.ownerId])}
      initialData={data}
      paymentPending={Boolean(activeData)}
      setPaymentPending={(pending) => setActiveData(pending ? data : null)}
    />
  );
}

function CheckoutForm({
  initialData,
  paymentPending,
  setPaymentPending,
}: {
  initialData: CheckoutPageData;
  paymentPending: boolean;
  setPaymentPending: (pending: boolean) => void;
}) {
  const {
    items,
    isReady,
    hasCartView,
    validationStatus,
    retryValidation,
    writePending,
    writeError,
    captureCheckoutSnapshot,
    bindCheckoutSnapshot,
  } = useCart();
  const { user, isLoading, isSessionUnavailable, isIdentityCurrent, refreshSession } =
    useSession();
  const owner = initialData.isGuest ? null : initialData.customer.ownerId;
  const sameOwner =
    owner !== undefined &&
    (initialData.isGuest || owner !== null) &&
    owner === (user?.id ?? null);
  const ready =
    sameOwner &&
    isReady &&
    !isLoading &&
    !isSessionUnavailable &&
    !writePending &&
    validationStatus !== "error" &&
    validationStatus !== "loading";
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [email, setEmail] = useState(initialData.customer.email);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("ship");
  const [address, setAddress] = useState(() => ({ ...initialData.customer.address }));
  const [quoteState, setQuoteState] = useState<CheckoutQuoteState>({
    status: "loading",
  });
  const [resolvedQuoteKey, setResolvedQuoteKey] = useState<string | null>(null);
  if (!ready && resolvedQuoteKey !== null) setResolvedQuoteKey(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const requestSequence = useRef(0);
  const didCaptureCheckoutStart = useRef(false);

  useEffect(() => {
    if (
      didCaptureCheckoutStart.current ||
      !hasUsableCheckout({
        cartReady: sameOwner && isReady,
        itemCount: items.length,
        isRedirecting,
      })
    ) {
      return;
    }
    didCaptureCheckoutStart.current = true;
    captureCheckoutStarted();
  }, [sameOwner, isReady, items.length, isRedirecting]);

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
    if (!ready || checkoutItems.length === 0) {
      return;
    }
    const requestId = ++requestSequence.current;
    const controller = new AbortController();
    const delay = fulfillment === "ship" && shippingAddress ? 300 : 0;
    const timer = window.setTimeout(() => {
      if (!isIdentityCurrent(owner ?? null)) return;
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
          if (!controller.signal.aborted && requestSequence.current === requestId) {
            setResolvedQuoteKey(quoteKey);
            setQuoteState({ status: "ready", quote });
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestSequence.current !== requestId) {
            return;
          }
          setResolvedQuoteKey(quoteKey);
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
  }, [
    ready,
    quoteKey,
    checkoutItems,
    fulfillment,
    shippingAddress,
    isIdentityCurrent,
    owner,
  ]);

  const quoteReady =
    ready && quoteState.status === "ready" && resolvedQuoteKey === quoteKey;
  const exactQuote =
    quoteReady && quoteState.quote.completeness === "exact" ? quoteState.quote : null;
  const currentQuote = quoteState.quote ?? null;

  function updateAddress(field: keyof CheckoutAddressForm, value: string) {
    setAddress((current) => ({ ...current, [field]: value }));
  }

  function requireCurrentCheckout() {
    if (!ready || !isIdentityCurrent(owner ?? null))
      throw new CheckoutCartUnavailable(
        "Your checkout changed. Review your cart before paying.",
      );
  }
  async function quoteWalletShippingDestination(nextAddress: WalletShippingDestination) {
    requireCurrentCheckout();
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
    requireCurrentCheckout();
    const nextQuote = await requestCheckoutQuote({
      items: checkoutItems,
      fulfillment: "ship",
      shippingAddress: nextAddress,
    });
    if (nextQuote.completeness !== "exact") {
      throw new Error("Unable to calculate an exact total for this address.");
    }
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
    const buyerEmail = (initialData.isGuest ? (context?.buyerEmail ?? email) : email)
      .trim()
      .toLowerCase();
    const selectedQuote = context?.quote ?? exactQuote;
    const selectedShippingAddress = context?.shippingAddress ?? shippingAddress;
    const selectedBillingAddress = context?.billingAddress ?? null;
    const pickup =
      fulfillment === "pickup"
        ? checkoutPickupContactSchema.safeParse(
            context?.pickupContact ?? { name: address.name, phone: address.phone },
          )
        : null;
    if (pickup && !pickup.success) {
      throw new Error("Enter a pickup name and valid phone number before paying.");
    }
    const selectedPickupContact = pickup?.success ? pickup.data : null;
    if (!buyerEmail || !selectedQuote) {
      throw new Error("Complete your contact and delivery details before paying.");
    }
    if (fulfillment === "ship" && !selectedShippingAddress) {
      throw new Error("Enter a complete US shipping address before paying.");
    }

    requireCurrentCheckout();
    let snapshot;
    try {
      snapshot = captureCheckoutSnapshot();
    } catch {
      throw new CheckoutCartUnavailable(
        "Your cart changed or is unavailable. Review your cart before paying.",
      );
    }
    const cartFingerprint = JSON.stringify({
      items: checkoutItems,
      fulfillment,
      buyerEmail,
      paymentMethod: method,
      shippingAddress: selectedShippingAddress,
      billingAddress: selectedBillingAddress,
      pickupContact: selectedPickupContact,
      quoteFingerprint: selectedQuote.quoteFingerprint,
    });
    const deviceSessionId = getOrCreateCheckoutDeviceSessionId();
    const idempotencyKey = getOrCreateCheckoutIdempotencyKey(cartFingerprint);
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
          pickupContact: selectedPickupContact,
          quoteFingerprint: selectedQuote.quoteFingerprint,
          shippingConfirmation: context?.shippingConfirmation,
          shippingAddressOverride: context?.shippingAddressOverride,
          idempotencyKey,
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
          typeof data?.shippingConfirmation === "string"
            ? data.shippingConfirmation
            : undefined,
          typeof data?.enteredShippingConfirmation === "string"
            ? data.enteredShippingConfirmation
            : undefined,
          data.code,
        );
      }
      if (response.status === 409) {
        clearCheckoutAttempt(idempotencyKey);
        setQuoteRevision((value) => value + 1);
      }
      throw new Error(data?.error || "Unable to prepare checkout");
    }
    if (
      typeof data?.orderId !== "string" ||
      ![
        data?.totals?.subtotalCents,
        data?.totals?.shippingCents,
        data?.totals?.taxCents,
        data?.totals?.totalCents,
      ].every(isCents)
    ) {
      throw new Error("Checkout returned invalid payment details");
    }
    if (data.reused === false) await bindCheckoutSnapshot(data.orderId, snapshot);
    if (typeof data.guestAccessToken === "string" && data.guestAccessToken) {
      storeGuestOrderAccess(data.orderId, data.guestAccessToken);
    }
    return {
      orderId: data.orderId,
      idempotencyKey,
      guestAccessToken: data.guestAccessToken,
      deviceSessionId,
      totals: data.totals,
    };
  }

  if (isRedirecting) {
    return <CheckoutPaymentDialog open />;
  }
  const failed = isSessionUnavailable || validationStatus === "error";
  const retryCheckout = () => {
    if (isSessionUnavailable) void refreshSession();
    else retryValidation();
  };
  const recovery = (
    <div className="mx-auto max-w-3xl space-y-2 px-5 py-4">
      <p role={failed ? "alert" : "status"}>
        {failed
          ? "We could not verify your checkout."
          : writePending
            ? "Saving your cart…"
            : "Checking your checkout…"}
      </p>
      {failed && (
        <button type="button" className="underline" onClick={retryCheckout}>
          Retry checkout
        </button>
      )}
      <a className="ml-3 underline" href="/cart">
        Review your cart
      </a>
    </div>
  );
  if (!paymentPending) {
    if (!sameOwner && !isLoading && !isSessionUnavailable)
      return (
        <main className="mx-auto max-w-2xl px-5 py-16">
          <CheckoutPaymentDialog open={false} />
          <p>Your checkout account changed. Reload checkout to continue.</p>
          <a className="underline" href="/checkout">
            Reload checkout
          </a>
        </main>
      );
    if (!sameOwner || (!isReady && (!hasCartView || items.length === 0)))
      return (
        <>
          <CheckoutPaymentDialog open={false} />
          {failed ? recovery : <CheckoutSkeleton />}
        </>
      );
    if (isReady && !items.length)
      return (
        <main className="mx-auto max-w-2xl px-5 py-16">
          <CheckoutPaymentDialog open={false} />
          <h1>Your cart is empty</h1>
          <Link className="underline" href="/store">
            Continue shopping
          </Link>
        </main>
      );
  }
  const summaryState: CheckoutQuoteState = failed
    ? { status: "error", message: "Totals unavailable until checkout is verified." }
    : ready && resolvedQuoteKey === quoteKey
      ? quoteState
      : { status: "loading" };
  return (
    <div data-checkout className="min-h-screen bg-[#f3f3f3]">
      <CheckoutHeader />
      {!ready && sameOwner && recovery}
      {writeError && sameOwner && <p role="alert">{writeError}</p>}
      <main
        style={!sameOwner ? { display: "none" } : undefined}
        className="grid min-h-[calc(100vh-7rem)] w-full grid-cols-1 bg-[#f3f3f3] text-zinc-950 lg:grid-cols-[53.4%_46.6%]"
      >
        <CheckoutOrderSummary
          className="order-1 lg:order-2"
          items={items}
          quoteState={summaryState}
          onRetry={ready ? () => setQuoteRevision((n) => n + 1) : undefined}
        />

        <section className="order-2 px-5 py-10 sm:px-8 lg:order-1 lg:ml-auto lg:w-full lg:max-w-[36.25rem] lg:px-10 lg:py-16">
          <h1 className="sr-only">Checkout</h1>
          <div className="flex flex-col">
            <SquarePaymentMethods
              reviewOwner={{
                verified: sameOwner && !isLoading && !isSessionUnavailable,
                isCurrent: () => sameOwner && isIdentityCurrent(owner ?? null),
              }}
              paymentConfig={initialData.paymentConfig}
              quote={currentQuote}
              quoteReady={quoteReady}
              fulfillment={fulfillment}
              buyerEmail={email}
              shippingAddress={shippingAddress}
              pickupContact={
                fulfillment === "pickup"
                  ? { name: address.name, phone: address.phone }
                  : null
              }
              isGuest={initialData.isGuest}
              quoteWalletShippingDestination={quoteWalletShippingDestination}
              resolveWalletShippingContact={resolveWalletShippingContact}
              prepare={prepare}
              onPaymentPending={setPaymentPending}
              onPaymentSubmitted={(checkout) => {
                setIsRedirecting(true);
                if (checkout.idempotencyKey)
                  clearCheckoutAttempt(checkout.idempotencyKey);
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
