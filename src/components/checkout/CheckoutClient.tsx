"use client";
import { BasketAccessNotice, type ValidationOrder } from "@/Modules/Cart/Source/Client";

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
  capturePreparedAttempt,
  readGuestOrderAccess,
  needsOriginalRecovery,
  recoverOriginalOrder,
  useCheckoutRegistration,
  useProcessingCredential,
} from "@/Modules/Checkout/Source/Client";
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
import { z } from "zod";
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
  recoveryOnly?: true;
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
  const cart = useCart();
  const { items, isReady: cartReady, scopeValidationToOrder } = cart;
  const router = useRouter();
  const scopes = useCheckoutRegistration();
  const remember = useProcessingCredential();
  const credential = useRef(remember);
  useLayoutEffect(() => {
    credential.current = remember;
  }, [remember]);
  const activeAttempt = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => activeAttempt.current?.abort(), []);
  const isReady = verified && cartReady;
  // An owned prepare can finish during a visibility check; attach its reference
  // through the newly verified connection when that continuation resumes.
  const pendingScope = useRef<ValidationOrder | null>(null);
  const readyScopeAction = useRef<typeof scopeValidationToOrder | null>(null);
  useLayoutEffect(() => {
    readyScopeAction.current = isReady ? scopeValidationToOrder : null;
    function register(order: ValidationOrder, action: typeof scopeValidationToOrder) {
      const release = action(order);
      scopes?.register(order.orderId, order.guestAccessToken ?? null, release);
    }
    if (readyScopeAction.current && pendingScope.current) {
      register(pendingScope.current, readyScopeAction.current);
      pendingScope.current = null;
    }
    return () => {
      readyScopeAction.current = null;
    };
  }, [isReady, scopeValidationToOrder, initialData.ownerId, scopes]);
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

  const [needsRecovery, setNeedsRecovery] = useState(() =>
    needsOriginalRecovery(initialData.ownerId),
  );
  const [recoveryLookup, setRecoveryLookup] = useState<"idle" | "checking" | "failed">(
    "idle",
  );
  const lookupFlight = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => lookupFlight.current?.abort(), []);
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
  const latestCart = useRef(cart);
  const captureView = useRef(cart.captureForCheckout);
  useLayoutEffect(() => {
    if (isReady) {
      captureView.current = cart.captureForCheckout;
      latestCart.current = cart;
    }
  }, [isReady, cart]);
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
  const activeOwnHold =
    stockBlocked &&
    items.every((i) => !i.availability && i.previousPriceCents === undefined);
  // Keep a prepared wallet's SDK attached during its verified reservation. The
  // quoteReady gate still blocks new authorizations against order-scoped stock.
  const currentQuote =
    (stockBlocked && !activeOwnHold) || needsRecovery ? null : (quoteState.quote ?? null);

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
    if (needsOriginalRecovery(initialData.ownerId)) {
      setNeedsRecovery(true);
      throw Error("Check your original order status before trying another payment.");
    }
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

    const fingerprint = (original: readonly (typeof checkoutItems)[number][]) =>
      JSON.stringify({
        items: original,
        fulfillment,
        buyerEmail,
        paymentMethod: method,
        shippingAddress: selectedShippingAddress,
        billingAddress: selectedBillingAddress,
        pickupContact: selectedPickupContact,
        quoteFingerprint: selectedQuote.quoteFingerprint,
      });
    const deviceSessionId = getOrCreateCheckoutDeviceSessionId();
    activeAttempt.current?.abort();
    const lifetime = new AbortController();
    activeAttempt.current = lifetime;
    const renderedCapture = latestCart.current.captureForCheckout;
    const attempt = await capturePreparedAttempt(
      {
        ...latestCart.current,
        bindPreparedOrder: async (id, order, signal) => {
          await requireOwner();
          return latestCart.current.bindPreparedOrder(id, order, signal);
        },
      },
      checkoutItems,
      fingerprint,
      lifetime.signal,
      () => setQuoteRevision((n) => n + 1),
      () =>
        captureView.current === renderedCapture && currentBasket.current === basketKey,
      initialData.ownerId,
    );
    const attemptKey = attempt.key;
    await requireOwner();
    assertCurrentBasket();
    if (!attempt.current() || lifetime.signal.aborted)
      throw Error("Your checkout changed. Review your current order.");
    if (attempt.recoveryOnly) {
      attempt.requireRecovery();
      setNeedsRecovery(true);
    }
    const response = await fetch("/api/checkout/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildCheckoutPreparePayload({
          items: attempt.items,
          fulfillment,
          paymentMethod: method,
          buyerEmail,
          shippingAddress: selectedShippingAddress,
          billingAddress: selectedBillingAddress,
          pickupContact: selectedPickupContact,
          quoteFingerprint: selectedQuote.quoteFingerprint,
          shippingConfirmation: attempt.recoveryOnly
            ? undefined
            : context?.shippingConfirmation,
          shippingAddressOverride: attempt.recoveryOnly
            ? undefined
            : context?.shippingAddressOverride,
          ...(attempt.recoveryOnly ? { recoveryOnly: true as const } : {}),
          idempotencyKey: attemptKey,
          deviceSessionId,
        }),
      ),
    });
    const data = await response.json().catch(() => null);
    await requireOwner();
    if (lifetime.signal.aborted || !attempt.current())
      throw Error(
        data?.code === "INVENTORY_CONFLICT"
          ? "Your cart changed. Review your items before paying."
          : "Your checkout changed. Review your current order.",
      );
    assertCurrentBasket();
    const observeOnly =
      data?.code === "CHECKOUT_RECOVERY_REQUIRED" &&
      z.uuid().safeParse(data?.orderId).success;
    if (!response.ok && !observeOnly) {
      if (
        attempt.recoveryOnly ||
        (attempt.resumed &&
          response.status === 409 &&
          data?.code !== "INVENTORY_CONFLICT" &&
          data?.code !== "CHECKOUT_RECOVERY_REQUIRED")
      ) {
        setNeedsRecovery(true);
        attempt.requireRecovery();
        throw Error(
          "Check your order status in your account or through your secure order link before trying another payment.",
        );
      }
      if (
        data?.code === "INVENTORY_CONFLICT" ||
        data?.code === "CHECKOUT_RECOVERY_REQUIRED"
      ) {
        const pending =
          "Check your order status in your account or through your secure order link before trying another payment.";
        if (
          attempt.resumed &&
          (data?.code === "CHECKOUT_RECOVERY_REQUIRED" ||
            data?.paymentState !== "not_submitted")
        )
          attempt.requireRecovery();
        const sameAttempt = () => !lifetime.signal.aborted && attempt.current();
        if (!sameAttempt())
          throw new Error("Your cart changed. Review your items before paying.");
        const conflicts = inventoryConflict.array().nonempty().safeParse(data.conflicts);
        if (
          data.code === "INVENTORY_CONFLICT" &&
          response.status === 409 &&
          conflicts.success
        ) {
          if (data.paymentState !== "not_submitted") {
            // Recovery belongs to the verified financial pair even if its Cart
            // connection has retired or its optional stock update cannot persist.
            setNeedsRecovery(true);
            void attempt.applyStockConflicts?.(conflicts.data, true, sameAttempt);
            throw new Error(pending);
          }
          const saved = await attempt.applyStockConflicts?.(
            conflicts.data,
            false,
            sameAttempt,
          );
          await requireOwner();
          if (saved?.status === "saved" && sameAttempt()) {
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
            attempt.reject();
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
        attempt.reject();
        setQuoteRevision((value) => value + 1);
      }
      throw new Error(data?.error || "Unable to prepare checkout");
    }
    if (
      !z.uuid().safeParse(data?.orderId).success ||
      typeof data?.totals?.subtotalCents !== "number" ||
      typeof data?.totals?.shippingCents !== "number" ||
      typeof data?.totals?.taxCents !== "number" ||
      typeof data?.totals?.totalCents !== "number"
    ) {
      throw new Error("Checkout returned invalid payment details");
    }
    const token =
      initialData.isGuest && typeof data.guestAccessToken === "string"
        ? data.guestAccessToken
        : undefined;
    if (observeOnly) attempt.requireRecovery(data.orderId);
    const bound = await attempt.prepared(data.orderId, token, observeOnly);
    await requireOwner();
    if (
      lifetime.signal.aborted ||
      !attempt.current() ||
      (initialData.isGuest && !attempt.credentialCurrent())
    )
      throw Error("Your checkout changed. Review your current order.");
    const stored = initialData.isGuest ? readGuestOrderAccess(data.orderId) : null;
    const guestAccessToken = token || stored || undefined;
    const transientGuestAccessToken = token && token !== stored ? token : undefined;
    if (!bound) {
      attempt.requireRecovery(data.orderId);
      onProcessing(data.orderId, transientGuestAccessToken);
      router.replace("/checkout/processing?orderId=" + encodeURIComponent(data.orderId));
      throw Error("Checking your original order status.");
    }
    const orderScope = { orderId: data.orderId, guestAccessToken };
    if (readyScopeAction.current) {
      const release = readyScopeAction.current(orderScope);
      scopes?.register(data.orderId, guestAccessToken ?? null, release);
    } else pendingScope.current = orderScope;
    const assertFinancialAttempt = () => {
      if (
        lifetime.signal.aborted ||
        !attempt.current() ||
        (initialData.isGuest && !attempt.credentialCurrent())
      )
        throw Error("Your checkout changed. Review your current order.");
    };
    return {
      assertCurrentBasket: () => {
        assertCurrentBasket();
        assertFinancialAttempt();
      },
      assertFinancialAttempt,
      orderId: data.orderId,
      guestAccessToken,
      transientGuestAccessToken,
      deviceSessionId,
      totals: data.totals,
    };
  }

  async function checkOriginalOrder() {
    if (lookupFlight.current) return;
    const controller = new AbortController();
    lookupFlight.current = controller;
    setRecoveryLookup("checking");
    try {
      const reference = await recoverOriginalOrder(
        initialData.ownerId,
        requireOwner,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      onProcessing(reference.orderId, reference.transientGuestAccessToken);
      router.replace(
        "/checkout/processing?orderId=" + encodeURIComponent(reference.orderId),
      );
    } catch {
      if (!controller.signal.aborted) setRecoveryLookup("failed");
    } finally {
      if (lookupFlight.current === controller) lookupFlight.current = null;
    }
  }
  function onProcessing(orderId: string, token?: string) {
    credential.current?.(orderId, token);
    setIsRedirecting(true);
  }

  if (isRedirecting) return <CheckoutPaymentDialog open={verified} />;
  if ((!isReady && !hasOpened) || (isReady && items.length === 0 && !needsRecovery)) {
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
                  {needsRecovery && needsOriginalRecovery(initialData.ownerId) && (
                    <button
                      type="button"
                      disabled={recoveryLookup === "checking"}
                      className="mr-3 underline"
                      onClick={() => void checkOriginalOrder()}
                    >
                      {recoveryLookup === "checking"
                        ? "Checking original order…"
                        : "Check original order"}
                    </button>
                  )}
                  {needsRecovery && recoveryLookup === "failed" && (
                    <p>
                      We could not find your original order. Try checking again or open
                      your secure order link.
                    </p>
                  )}
                  {needsRecovery && (
                    <a className="mr-3 underline" href="/account">
                      Check order status
                    </a>
                  )}
                  <a className="underline" href="/cart">
                    Review cart
                  </a>
                </div>
              )}
              <SquarePaymentMethods
                accessSuspended={!isReady}
                recoveryRequired={needsRecovery}
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
                onProcessing={onProcessing}
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
