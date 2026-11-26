"use client";
import { BasketAccessNotice } from "@/Modules/Cart/Source/Client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/contexts/SessionContext";
import { useCheckoutOwnerAccess } from "@/Modules/Checkout/Source/Features/Preparation/use-checkout-owner-access";

import { inventoryConflict } from "@/Modules/Checkout/Source/Features/Preparation/reservation-contract";
import { provenConflictMessage, needsBasketReview } from "@/Modules/Cart/Source/Client";
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
  isCurrentCheckoutAttempt,
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
import { clearIdempotencyKeyFromStorage } from "@/lib/checkout/idempotency";
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
  const { status, user } = useSession();
  const router = useRouter();
  const ownerId = user?.id ?? null;
  const mismatch =
    status === "ready" &&
    (initialData.ownerId !== ownerId || initialData.isGuest !== (ownerId === null));
  useEffect(() => {
    if (mismatch) router.refresh();
  }, [mismatch, ownerId, router]);
  if (mismatch)
    return (
      <>
        <CheckoutPaymentDialog open={false} />
        <section role="status" className="p-6 text-center">
          <p>Updating your checkout details…</p>
          <button
            type="button"
            className="mt-3 underline"
            onClick={() => router.refresh()}
          >
            Refresh checkout
          </button>
        </section>
      </>
    );
  return (
    <OwnerCheckout
      key={initialData.ownerId === null ? "guest" : "account:" + initialData.ownerId}
      initialData={initialData}
      verified={status === "ready"}
    />
  );
}

function OwnerCheckout({
  initialData,
  verified,
}: {
  initialData: CheckoutPageData;
  verified: boolean;
}) {
  const {
    items,
    isReady: cartReady,
    clearCart,
    applyStockConflicts,
    scopeValidationToOrder,
  } = useCart();
  const isReady = verified && cartReady;
  const { isCurrent } = useSession();
  const [hasOpened, setHasOpened] = useState(false);
  if (isReady && items.length && !hasOpened) setHasOpened(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [email, setEmail] = useState(initialData.customer.email);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("ship");
  const [address, setAddress] = useState(initialData.customer.address);
  const [quoteState, setQuoteState] = useState<CheckoutQuoteState>({
    status: "loading",
  });
  const [resolvedQuote, setResolvedQuote] = useState<{
    key: string;
    observation: () => boolean;
  } | null>(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const requestSequence = useRef(0);
  const didCaptureCheckoutStart = useRef(false);

  useEffect(() => {
    if (
      didCaptureCheckoutStart.current ||
      !hasUsableCheckout({ cartReady: isReady, itemCount: items.length, isRedirecting })
    ) {
      return;
    }
    didCaptureCheckoutStart.current = true;
    captureCheckoutStarted();
  }, [isReady, items.length, isRedirecting]);

  const [needsRecovery, setNeedsRecovery] = useState(false);
  const stockBlocked = items.some(needsBasketReview);
  const basketKey = JSON.stringify(
    items.map((i) => [
      i.productId,
      i.variantId,
      i.quantity,
      i.priceCents,
      i.availability,
      i.previousPriceCents,
    ]),
  );
  const currentBasket = useRef(basketKey);
  useLayoutEffect(() => {
    if (isReady) currentBasket.current = basketKey;
  }, [basketKey, isReady]);
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
    basketKey,
    stockBlocked,
    needsRecovery,
  });

  useEffect(() => {
    if (!isReady || checkoutItems.length === 0 || stockBlocked || needsRecovery) {
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
          if (!controller.signal.aborted && requestSequence.current === requestId) {
            setResolvedQuote({ key: quoteKey, observation: isCurrent });
            setQuoteState({ status: "ready", quote });
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestSequence.current !== requestId) {
            return;
          }
          setResolvedQuote({ key: quoteKey, observation: isCurrent });
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
    isReady,
    isCurrent,
    quoteKey,
    checkoutItems,
    fulfillment,
    shippingAddress,
    stockBlocked,
    needsRecovery,
  ]);

  // A matching basket can return before the quote from its new observation does.
  const quotePending =
    !isReady ||
    resolvedQuote?.key !== quoteKey ||
    resolvedQuote.observation !== isCurrent ||
    quoteState.status === "loading";
  const requireOwner = useCheckoutOwnerAccess(
    initialData.ownerId,
    quotePending && !stockBlocked && !needsRecovery,
  );
  const quoteReady =
    !stockBlocked && !needsRecovery && !quotePending && quoteState.status === "ready";
  const exactQuote =
    quoteReady && quoteState.quote.completeness === "exact" ? quoteState.quote : null;
  const currentQuote = stockBlocked || needsRecovery ? null : (quoteState.quote ?? null);

  function updateAddress(field: keyof CheckoutAddressForm, value: string) {
    setAddress((current) => ({ ...current, [field]: value }));
  }

  async function quoteWalletShippingDestination(nextAddress: WalletShippingDestination) {
    await requireOwner();
    const nextQuote = await requestCheckoutQuote({
      items: checkoutItems,
      fulfillment: "ship",
      shippingAddress: nextAddress,
    });
    await requireOwner();
    if (nextQuote.completeness !== "exact") {
      throw new Error("Unable to calculate shipping for this destination.");
    }
    return { quote: nextQuote };
  }

  async function resolveWalletShippingContact(
    nextAddress: CheckoutPaymentAddress,
    walletEmail?: string,
  ): Promise<WalletCheckoutContext> {
    await requireOwner();
    const nextQuote = await requestCheckoutQuote({
      items: checkoutItems,
      fulfillment: "ship",
      shippingAddress: nextAddress,
    });
    await requireOwner();
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
    await requireOwner();
    const assertCurrentBasket = () => {
      if (basketKey !== currentBasket.current)
        throw new Error("Your cart changed. Review your items before paying.");
    };
    assertCurrentBasket();
    if (stockBlocked || needsRecovery)
      throw new Error("Review your cart and check your order status before paying.");
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
    const attemptKey = getOrCreateCheckoutIdempotencyKey(cartFingerprint);
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
          idempotencyKey: attemptKey,
          deviceSessionId,
        }),
      ),
    });
    const data = await response.json().catch(() => null);
    await requireOwner();
    assertCurrentBasket();
    if (!response.ok) {
      if (
        data?.code === "INVENTORY_CONFLICT" ||
        data?.code === "CHECKOUT_RECOVERY_REQUIRED"
      ) {
        const pending =
          "Check your order status in your account or through your secure order link before trying another payment.";
        const conflicts = inventoryConflict.array().nonempty().safeParse(data.conflicts);
        if (
          data.code === "INVENTORY_CONFLICT" &&
          response.status === 409 &&
          conflicts.success &&
          isCurrentCheckoutAttempt(attemptKey, cartFingerprint)
        ) {
          const knownUnsubmitted = data.paymentState === "not_submitted";
          const saved = await applyStockConflicts(conflicts.data, !knownUnsubmitted);
          await requireOwner();
          if (
            saved.status === "saved" &&
            isCurrentCheckoutAttempt(attemptKey, cartFingerprint)
          ) {
            if (!knownUnsubmitted) {
              setNeedsRecovery(true);
              throw new Error(pending);
            }
            const message = conflicts.data
              .map((c) =>
                provenConflictMessage(
                  items.find(
                    (i) => i.productId === c.productId && i.variantId === c.variantId,
                  )!,
                  c.reason,
                  c.availableQuantity,
                ),
              )
              .join(" ");
            clearIdempotencyKeyFromStorage();
            throw new Error(message);
          }
          throw new Error("Your cart changed. Review your items before paying.");
        }
        setNeedsRecovery(true);
        throw new Error(pending);
      }
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
    scopeValidationToOrder({
      orderId: data.orderId,
      guestAccessToken: data.guestAccessToken,
    });
    return {
      assertCurrentBasket,
      orderId: data.orderId,
      guestAccessToken: data.guestAccessToken,
      deviceSessionId,
      totals: data.totals,
    };
  }

  if (isRedirecting) return <CheckoutPaymentDialog open={verified} />;
  if ((!isReady && !hasOpened) || (isReady && items.length === 0)) {
    return (
      <>
        <CheckoutPaymentDialog open={false} />
        {!isReady && <BasketAccessNotice />}
      </>
    );
  }

  return (
    <>
      {!isReady && <BasketAccessNotice />}
      <div
        hidden={!isReady}
        inert={!isReady}
        data-checkout
        className="min-h-screen bg-[#f3f3f3]"
      >
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
              {(stockBlocked || needsRecovery) && (
                <div role="status">
                  <p>
                    {needsRecovery
                      ? "Check your order status before trying another payment."
                      : "Review the items in your cart before paying."}
                  </p>
                  <a className="underline" href="/cart">
                    Review cart
                  </a>
                </div>
              )}
              <SquarePaymentMethods
                accessSuspended={!isReady}
                requireOwner={requireOwner}
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
                clearCart={() => {
                  setIsRedirecting(true);
                  clearIdempotencyKeyFromStorage();
                  void clearCart();
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
    </>
  );
}
