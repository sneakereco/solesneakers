"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";

import {
  EMPTY_BILLING_ADDRESS,
  type CheckoutBillingAddressForm,
} from "@/components/checkout/BillingAddressFields";
import { CheckoutPaymentPanel } from "@/components/checkout/CheckoutPaymentPanel";
import { CheckoutPaymentDialog } from "@/components/checkout/CheckoutPaymentDialog";
import {
  CheckoutWalletDetails,
  checkoutEmailSchema,
  type WalletDetails,
  type WalletDetailsReview,
} from "@/components/checkout/CheckoutWalletDetails";
import {
  afterpayShippingUpdate,
  matchesAfterpayAddress,
  matchesAfterpayTokenAddress,
  type AfterpayCheckoutContext,
} from "@/components/checkout/afterpay-shipping";
import { ExpressCheckoutMethods } from "@/components/checkout/ExpressCheckoutMethods";
import { validateCheckoutFields } from "@/components/checkout/CheckoutField";
import { useSquareCardState } from "@/components/checkout/useSquareCardState";
import { squareCardStyle } from "@/components/checkout/square-card-style";
import {
  squarePaymentDiagnostic,
  type SquarePaymentPhase,
} from "@/components/checkout/square-payment-diagnostics";
import {
  createSquareMethodLifecycle,
  updateSquarePaymentRequest,
  assertPaymentQuoteCurrent,
} from "@/components/checkout/square-method-lifecycle";
import { withRequestDeadline } from "@/lib/http/request-deadline";
import { clientEnv } from "@/config/client-env";
import type { CheckoutPageData } from "@/lib/checkout/checkout-page-data";
import type {
  CheckoutQuoteResponse,
  CheckoutBillingAddress,
  CheckoutPickupContact,
  ExactCheckoutQuote,
  PaymentPermitRequest,
} from "@/lib/checkout/checkout-request";
import {
  checkoutBillingAddressSchema,
  checkoutPickupContactSchema,
  checkoutQuoteDestinationSchema,
  checkoutShippingAddressSchema,
} from "@/lib/checkout/checkout-request";
import {
  authorizeAndTokenize,
  authorizeTokenizedSource,
  loadSquareWebPayments,
  type SquareCashAppPayMethod,
  type SquarePaymentMethod,
  type SquarePaymentRequest,
  type SquareTokenResult,
} from "@/lib/square/web-payments";
import {
  ShippingAddressValidationError,
  type ShippingAddress,
} from "@/lib/checkout/shipping-address-validation";
import { log } from "@/lib/utils/log";

let nextCardHostId = 0;
let nextWalletHostId = 0;
function walletHost(parentId: string) {
  const host = document.createElement("div");
  host.id = "checkout-wallet-" + ++nextWalletHostId;
  document.getElementById(parentId)?.replaceChildren(host);
  return host;
}

export type PaymentMethod = PaymentPermitRequest["method"];
class CheckoutCancelled extends Error {}
class ExistingOrderHandoff extends Error {}

async function readUnavailablePayment(response: Response, request: AbortController) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timeout = setTimeout(() => {
      request.abort();
      resolve(null);
    }, 2_000);
  });
  try {
    return await Promise.race([response.json().catch(() => null), deadline]);
  } finally {
    clearTimeout(timeout);
  }
}
export class CheckoutCartUnavailable extends Error {}

export type CheckoutPaymentAddress = {
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: "US";
};

export type PreparedCheckout = {
  assertCurrentBasket?: () => void;
  orderId: string;
  guestAccessToken?: string;
  transientGuestAccessToken?: string;
  assertFinancialAttempt?: () => void;
  deviceSessionId: string;
  totals: ExactCheckoutQuote["totals"];
};

export type WalletCheckoutContext = {
  quote: ExactCheckoutQuote;
  shippingAddress: CheckoutPaymentAddress;
  buyerEmail?: string;
};

export type CheckoutPreparationContext = {
  shippingConfirmation?: string;
  shippingAddressOverride?: boolean;
  quote?: ExactCheckoutQuote;
  shippingAddress?: CheckoutPaymentAddress;
  buyerEmail?: string;
  billingAddress?: CheckoutBillingAddress | null;
  pickupContact?: CheckoutPickupContact | null;
};

export type WalletShippingDestination = {
  state: string;
  postalCode: string;
  country: "US";
};

type TurnstileApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function splitName(name: string): { givenName: string; familyName: string } {
  const [givenName, ...family] = name.trim().split(/\s+/);
  return {
    givenName: givenName ?? "",
    familyName: family.join(" ") || givenName || "",
  };
}

export function resolveBillingAddress(input: {
  fulfillment: "ship" | "pickup";
  sameAsShipping: boolean;
  shippingAddress: CheckoutPaymentAddress | null;
  billingAddress: CheckoutBillingAddressForm;
}): CheckoutBillingAddress | null {
  if (input.fulfillment === "ship" && input.sameAsShipping) {
    if (!input.shippingAddress) {
      return null;
    }
    const name = splitName(input.shippingAddress.name);
    return {
      ...name,
      phone: input.shippingAddress.phone,
      line1: input.shippingAddress.line1,
      line2: input.shippingAddress.line2,
      city: input.shippingAddress.city,
      state: input.shippingAddress.state,
      postalCode: input.shippingAddress.postalCode,
      country: "US",
    };
  }

  const parsed = checkoutBillingAddressSchema.safeParse({
    ...input.billingAddress,
    phone: input.billingAddress.phone.trim() || null,
    line2: input.billingAddress.line2.trim() || null,
  });
  return parsed.success
    ? {
        ...parsed.data,
        phone: parsed.data.phone ?? null,
        line2: parsed.data.line2 ?? null,
      }
    : null;
}

export function squareBillingContact(input: {
  cardholderName: string;
  buyerEmail: string;
  billingAddress: CheckoutBillingAddress;
}) {
  const name = splitName(input.cardholderName);
  return {
    givenName: name.givenName,
    familyName: name.familyName,
    email: input.buyerEmail,
    phone: input.billingAddress.phone || undefined,
    addressLines: [input.billingAddress.line1, input.billingAddress.line2].filter(
      (line): line is string => Boolean(line),
    ),
    city: input.billingAddress.city,
    state: input.billingAddress.state,
    postalCode: input.billingAddress.postalCode,
    countryCode: input.billingAddress.country,
  };
}

export function walletPaymentTotal(quote: CheckoutQuoteResponse) {
  return {
    amount: money(quote.totals.totalCents),
    label: quote.completeness === "exact" ? "Total" : "Estimated total",
    pending: quote.completeness !== "exact",
  };
}

export function assertWalletTotalUnchanged(
  displayedQuote: ExactCheckoutQuote | null,
  finalQuote: ExactCheckoutQuote,
): void {
  if (
    !displayedQuote ||
    displayedQuote.totals.totalCents !== finalQuote.totals.totalCents
  ) {
    throw new Error("Your total changed. Review the updated checkout and retry.");
  }
}

export function walletShippingAddress(value: unknown): CheckoutPaymentAddress {
  const candidate = value as {
    givenName?: unknown;
    familyName?: unknown;
    phone?: unknown;
    addressLines?: unknown;
    city?: unknown;
    state?: unknown;
    postalCode?: unknown;
    countryCode?: unknown;
  };
  const addressLines = Array.isArray(candidate?.addressLines)
    ? candidate.addressLines
    : [];
  const parsed = checkoutShippingAddressSchema.safeParse({
    name: [candidate?.givenName, candidate?.familyName]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .join(" "),
    phone: candidate?.phone,
    line1: addressLines[0],
    line2: addressLines[1] ?? null,
    city: candidate?.city,
    state: candidate?.state,
    postalCode: candidate?.postalCode,
    country: candidate?.countryCode,
  });
  if (!parsed.success) {
    throw new Error("Choose a complete US shipping address.");
  }
  return { ...parsed.data, line2: parsed.data.line2 ?? null };
}

export function walletBillingAddress(
  value: unknown,
  fallback?: CheckoutBillingAddressForm,
): CheckoutBillingAddress | null {
  const candidate = value as {
    givenName?: unknown;
    familyName?: unknown;
    phone?: unknown;
    addressLines?: unknown;
    city?: unknown;
    state?: unknown;
    postalCode?: unknown;
    countryCode?: unknown;
  };
  const addressLines = Array.isArray(candidate?.addressLines)
    ? candidate.addressLines
    : [];
  const parsed = checkoutBillingAddressSchema.safeParse({
    givenName: candidate?.givenName,
    familyName: candidate?.familyName,
    phone: candidate?.phone ?? null,
    line1: addressLines[0],
    line2: addressLines[1] ?? null,
    city: candidate?.city,
    state: candidate?.state,
    postalCode: candidate?.postalCode,
    country: candidate?.countryCode,
  });
  return parsed.success
    ? {
        ...parsed.data,
        phone: parsed.data.phone ?? null,
        line2: parsed.data.line2 ?? null,
      }
    : fallback
      ? resolveBillingAddress({
          fulfillment: "pickup",
          sameAsShipping: false,
          shippingAddress: null,
          billingAddress: fallback,
        })
      : null;
}

export function walletShippingDestination(value: unknown): WalletShippingDestination {
  const candidate = value as Record<string, unknown> | null;
  const parsed = checkoutQuoteDestinationSchema.safeParse({
    state: candidate?.state,
    postalCode: candidate?.postalCode,
    country: candidate?.countryCode,
  });
  if (!parsed.success) {
    throw new Error("Choose a valid US shipping destination.");
  }
  return parsed.data;
}

function walletShippingUpdate(quote: ExactCheckoutQuote) {
  return {
    shippingOptions: [
      {
        id: "STANDARD",
        label: "Standard shipping",
        amount: money(quote.totals.shippingCents),
      },
    ],
    shippingLineItems: [
      { label: "Shipping", amount: money(quote.totals.shippingCents), pending: false },
    ],
    taxLineItems: [
      { label: "Tax", amount: money(quote.totals.taxCents), pending: false },
    ],
    total: walletPaymentTotal(quote),
  };
}

export async function initializePaymentMethodsConcurrently(
  initializers: Array<() => Promise<void>>,
): Promise<void> {
  await Promise.allSettled(initializers.map((initialize) => initialize()));
}

export function bindWalletShippingContact(
  request: Pick<SquarePaymentRequest, "addEventListener">,
  resolveWalletShippingContact: (
    address: WalletShippingDestination,
  ) => Promise<{ quote: ExactCheckoutQuote }>,
  onResolved?: (context: { quote: ExactCheckoutQuote }) => void,
  fulfillment: "ship" | "pickup" = "ship",
): void {
  if (fulfillment === "pickup") {
    return;
  }
  request.addEventListener("shippingcontactchanged", async (value) => {
    try {
      const context = await resolveWalletShippingContact(
        walletShippingDestination(value),
      );
      onResolved?.(context);
      return walletShippingUpdate(context.quote);
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Unable to calculate shipping for this address.",
      };
    }
  });
}

function reportUnavailable(
  method: PaymentMethod,
  phase: SquarePaymentPhase,
  error: unknown,
): void {
  log(squarePaymentDiagnostic(method, phase, error));
}

function contact(name: string, email: string, address: CheckoutPaymentAddress | null) {
  const [givenName, ...family] = name.trim().split(/\s+/);
  return {
    givenName: givenName || name,
    familyName: family.join(" "),
    email,
    phone: address?.phone,
    addressLines: address ? [address.line1, address.line2].filter(Boolean) : undefined,
    city: address?.city,
    state: address?.state,
    postalCode: address?.postalCode,
    countryCode: "US",
  };
}

function checkedToken(result: SquareTokenResult): string {
  if (result.status === "CANCEL") throw new CheckoutCancelled();
  if (result.status !== "OK" || !result.token) {
    throw new Error("Payment details could not be verified");
  }
  return result.token;
}

export function turnstileErrorMessage(code: string): string | null {
  return code === "110200"
    ? "Guest verification is not configured for this checkout hostname."
    : null;
}

function loadTurnstile(parent: AbortSignal, attempt: number): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return withRequestDeadline(
    (signal) =>
      new Promise<TurnstileApi>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
          'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
        );
        const script = existing ?? document.createElement("script");
        function cleanup() {
          script.removeEventListener("load", loaded);
          script.removeEventListener("error", failed);
          signal.removeEventListener("abort", failed);
        }
        function failed() {
          cleanup();
          script.remove();
          reject(new Error("turnstile_unavailable"));
        }
        function loaded() {
          if (!window.turnstile) return failed();
          cleanup();
          resolve(window.turnstile);
        }
        signal.addEventListener("abort", failed, { once: true });
        script.addEventListener("load", loaded);
        script.addEventListener("error", failed);
        if (!existing) {
          script.src =
            "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" +
            (attempt ? "&retry=" + attempt : "");
          script.async = true;
          document.head.appendChild(script);
        }
      }),
    parent,
  );
}

export function SquarePaymentMethods({
  paymentConfig,
  quote,
  quoteReady = true,
  fulfillment,
  buyerEmail,
  shippingAddress,
  pickupContact = null,
  isGuest,
  quoteWalletShippingDestination,
  resolveWalletShippingContact,
  prepare,
  accessSuspended = false,
  recoveryRequired = false,
  requireOwner,
  onProcessing,
  reviewOwner,
  onPaymentPending,
  children,
}: {
  paymentConfig: CheckoutPageData["paymentConfig"];
  quote: CheckoutQuoteResponse | null;
  quoteReady?: boolean;
  fulfillment: "ship" | "pickup";
  buyerEmail: string;
  shippingAddress: CheckoutPaymentAddress | null;
  pickupContact?: CheckoutPickupContact | null;
  isGuest: boolean;
  quoteWalletShippingDestination(
    destination: WalletShippingDestination,
  ): Promise<{ quote: ExactCheckoutQuote }>;
  resolveWalletShippingContact(
    address: CheckoutPaymentAddress,
    buyerEmail?: string,
  ): Promise<WalletCheckoutContext>;
  prepare(
    method: PaymentMethod,
    context?: CheckoutPreparationContext,
  ): Promise<PreparedCheckout>;
  accessSuspended?: boolean;
  recoveryRequired?: boolean;
  requireOwner?: (options?: { waitForQuote: true }) => Promise<void>;
  onProcessing(orderId: string, token?: string): void;
  reviewOwner?: { verified: boolean; isCurrent(): boolean };
  onPaymentPending?(pending: boolean): void;
  children?: ReactNode;
}) {
  const canShowReview = reviewOwner?.verified ?? true;
  const reviewAccess = useRef<{
    owner: typeof reviewOwner;
    suspended: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    reviewAccess.current = { owner: reviewOwner, suspended: accessSuspended };
    return () => {
      reviewAccess.current = null;
    };
  }, [reviewOwner, accessSuspended]);
  function isReviewOwnerCurrent() {
    const access = reviewAccess.current;
    return Boolean(
      access && (!access.owner || (access.owner.verified && access.owner.isCurrent())),
    );
  }
  function canActOnReview() {
    return reviewAccess.current?.suspended === false && isReviewOwnerCurrent();
  }
  function requireReviewOwner() {
    if (!isReviewOwnerCurrent())
      throw new CheckoutCartUnavailable(
        "Your checkout account changed. Review your cart before continuing.",
      );
  }
  const exactQuote = quoteReady && quote?.completeness === "exact" ? quote : null;
  const [payments, setPayments] = useState<Awaited<
    ReturnType<typeof loadSquareWebPayments>
  > | null>(null);
  const [sdkRetry, setSdkRetry] = useState(0);
  const [cardRetry, setCardRetry] = useState(0);
  const [cardLoadError, setCardLoadError] = useState(false);
  const cardHost = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<SquarePaymentMethod | null>(null);
  const [applePay, setApplePay] = useState<SquarePaymentMethod | null>(null);
  const [cashAppPay, setCashAppPay] = useState<SquareCashAppPayMethod | null>(null);
  const [afterpay, setAfterpay] = useState<SquarePaymentMethod | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<
    "card" | "cashAppPay" | "afterpay"
  >("card");
  const [sameAsShipping, setSameAsShipping] = useState(true);
  const [cardholderName, setCardholderName] = useState("");
  const [billingAddress, setBillingAddress] =
    useState<CheckoutBillingAddressForm>(EMPTY_BILLING_ADDRESS);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [verificationRetry, setVerificationRetry] = useState(0);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [turnstileWidget, setTurnstileWidget] = useState<string | null>(null);
  const [verificationGuest, setVerificationGuest] = useState(isGuest);
  if (verificationGuest !== isGuest) {
    setVerificationGuest(isGuest);
    setTurnstileToken(null);
    setTurnstileWidget(null);
    setVerificationError(null);
  }
  const [isPaying, setIsPaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [cartRecovery, setCartRecovery] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const router = useRouter();
  const [providerActive, setProviderActive] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<
    "Afterpay" | "Cash App Pay" | null
  >(null);
  const [walletReview, setWalletReview] = useState<WalletDetailsReview | null>(null);
  const walletContinuation = useRef<((value: WalletDetails | null) => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unavailableVerificationId =
    isGuest && !clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY
      ? "checkout-verification-unavailable"
      : undefined;
  const [addressReview, setAddressReview] =
    useState<ShippingAddressValidationError | null>(null);
  const [totalReview, setTotalReview] = useState<number | null>(null);
  const [cashAppReapproval, setCashAppReapproval] = useState(false);
  const addressContinuation = useRef<
    | ((
        value: {
          address: ShippingAddress;
          confirmation?: string;
          override?: boolean;
        } | null,
      ) => void)
    | null
  >(null);
  const totalContinuation = useRef<((accepted: boolean) => void) | null>(null);
  const cashAppCancellation = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      addressContinuation.current?.(null);
      walletContinuation.current?.(null);
      totalContinuation.current?.(false);
      cashAppCancellation.current?.();
    },
    [],
  );
  const [appleRetry, setAppleRetry] = useState(0);
  const [appleLoadError, setAppleLoadError] = useState(false);
  const [expressLoading, setExpressLoading] = useState(true);
  const { applicationId, environment, locationId } = paymentConfig;
  const configKey = JSON.stringify([applicationId, environment, locationId]);
  const [previousConfig, setPreviousConfig] = useState(configKey);
  if (previousConfig !== configKey) {
    setPreviousConfig(configKey);
    setPayments(null);
    setCard(null);
    setCardLoadError(false);
    setExpressLoading(true);
  }
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const cardholderNameInput = useRef<HTMLInputElement>(null);
  const billingFields = useRef<HTMLDivElement>(null);
  const regularForm = useRef<HTMLFormElement>(null);
  const cardInputError = useRef(false);
  const turnstileTokenRef = useRef<string | null>(null);
  const turnstileTerminalError = useRef(false);
  const walletQuote = useRef<ExactCheckoutQuote | null>(null);
  const quoteWalletShippingDestinationRef = useRef(quoteWalletShippingDestination);
  const resolveWalletShippingContactRef = useRef(resolveWalletShippingContact);
  quoteWalletShippingDestinationRef.current = quoteWalletShippingDestination;
  resolveWalletShippingContactRef.current = resolveWalletShippingContact;
  const resolvedBillingAddress = useMemo(
    () =>
      resolveBillingAddress({
        fulfillment,
        sameAsShipping,
        shippingAddress,
        billingAddress,
      }),
    [billingAddress, fulfillment, sameAsShipping, shippingAddress],
  );

  const [methodErrors, setMethodErrors] = useState<
    Partial<Record<"cashAppPay" | "afterpay", string>>
  >({});
  const [methodRetries, setMethodRetries] = useState({ cashAppPay: 0, afterpay: 0 });
  const [lifecycles] = useState(() => ({
    applePay: createSquareMethodLifecycle<SquarePaymentMethod>(),
    cashAppPay: createSquareMethodLifecycle<SquareCashAppPayMethod>(),
    afterpay: createSquareMethodLifecycle<SquarePaymentMethod>(),
  }));
  const walletRequests = useRef<
    Partial<Record<"applePay" | "afterpay", SquarePaymentRequest>>
  >({});
  const paymentInFlight = useRef(false);
  const paymentInteraction = useRef(0);
  const cashAppApproving = useRef(false);
  const notifyPaymentPending = useRef(onPaymentPending);
  notifyPaymentPending.current = onPaymentPending;
  const latest = useRef({
    selectedMethod,
    resolvedBillingAddress,
    quote,
    quoteReady,
    fulfillment,
    buyerEmail,
    shippingAddress,
    exactQuote,
    isGuest,
  });
  latest.current = {
    selectedMethod,
    resolvedBillingAddress,
    quote,
    quoteReady,
    fulfillment,
    buyerEmail,
    shippingAddress,
    exactQuote,
    isGuest,
  };
  const submitCashAppRef = useRef(submitTokenizedWallet);
  submitCashAppRef.current = submitTokenizedWallet;
  const hasQuote = Boolean(quote);
  // An existing Afterpay request owns the pending prepare, including the interval
  // between reserving the final unit and registering its order-scoped validation.
  const keepAfterpayRequest =
    quote?.completeness === "exact" || loadingProvider === "Afterpay";
  const [approvalQuoteKey, setApprovalQuoteKey] = useState<string | null>(null);
  // Keep the provider instance that owns an open approval until it delivers its result.
  const cashAppQuoteKey =
    approvalQuoteKey ?? (quote?.completeness === "exact" ? quote.quoteFingerprint : null);
  const afterpayContext = useRef<
    (AfterpayCheckoutContext & Pick<PreparedCheckout, "assertCurrentBasket">) | null
  >(null);

  function updateTurnstileToken(token: string | null) {
    turnstileTokenRef.current = token;
    setTurnstileToken(token);
  }

  const cardState = useSquareCardState(card, submitRegularPayment);
  useEffect(() => {
    if (selectedMethod !== "card") {
      return;
    }
    const frame = requestAnimationFrame(() => card?.recalculateSize?.());
    return () => cancelAnimationFrame(frame);
  }, [card, selectedMethod]);

  useEffect(() => {
    let active = true;
    void loadSquareWebPayments({ applicationId, environment, locationId })
      .then((next) => {
        if (active) setPayments(next);
      })
      .catch((failure) => {
        if (active) {
          reportUnavailable("card", "load", failure);
          setCardLoadError(true);
          setExpressLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [applicationId, environment, locationId, sdkRetry]);

  useEffect(() => {
    if (!payments || !cardHost.current) return;
    let active = true;
    let current: SquarePaymentMethod | undefined;
    let phase: SquarePaymentPhase = "create";
    const host = document.createElement("div");
    host.id = "checkout-card-fields-" + ++nextCardHostId;
    cardHost.current.replaceChildren(host);
    function discard() {
      active = false;
      host.remove();
      const method = current;
      current = undefined;
      void method
        ?.destroy?.()
        .catch((failure) => reportUnavailable("card", "attach", failure));
    }
    function failed(failure: unknown) {
      if (!active) return;
      discard();
      reportUnavailable("card", phase, failure);
      setCardLoadError(true);
    }
    const deadline = window.setTimeout(
      () => failed(Error("square_card_initialization_timeout")),
      15000,
    );
    void (async () => {
      try {
        const method = await payments.card({ style: squareCardStyle });
        if (!active) {
          await method.destroy?.();
          return;
        }
        current = method;
        if (!method.attach) throw Error("square_card_attach_unavailable");
        phase = "attach";
        try {
          await method.attach("#" + host.id);
          if (active) setCard(method);
        } finally {
          // A retired attachment can allocate its iframe after early disposal.
          if (!active)
            await method
              .destroy?.()
              .catch((failure) => reportUnavailable("card", "attach", failure));
        }
      } catch (failure) {
        failed(failure);
      } finally {
        window.clearTimeout(deadline);
      }
    })();
    return () => {
      window.clearTimeout(deadline);
      discard();
    };
  }, [payments, cardRetry]);

  useEffect(() => {
    if (!payments || !hasQuote || !latest.current.quote) {
      return;
    }
    let active = true;
    setExpressLoading(true);
    setAppleLoadError(false);
    const requests = walletRequests.current;
    const initialQuote = latest.current.quote;
    void lifecycles.applePay
      .replace(
        () => {
          const request = payments.paymentRequest({
            countryCode: "US",
            currencyCode: "USD",
            total: walletPaymentTotal(initialQuote),
            requestShippingContact: latest.current.fulfillment === "ship",
            requestBillingContact: true,
          });
          bindWalletShippingContact(
            request,
            (value) => quoteWalletShippingDestinationRef.current(value),
            (context) => {
              walletQuote.current = context.quote;
            },
            fulfillment,
          );
          requests.applePay = request;
          return payments.applePay(request);
        },
        (method) => {
          if (active) setApplePay(method);
          return Promise.resolve();
        },
      )
      .catch((methodError) => {
        reportUnavailable("applePay", "create", methodError);
        if (
          active &&
          methodError instanceof DOMException &&
          methodError.name === "TimeoutError"
        )
          setAppleLoadError(true);
      })
      .finally(() => {
        if (active) setExpressLoading(false);
      });
    return () => {
      active = false;
      setApplePay(null);
      delete requests.applePay;
      void lifecycles.applePay
        .dispose()
        .catch((methodError) => reportUnavailable("applePay", "create", methodError));
    };
  }, [payments, hasQuote, fulfillment, appleRetry, lifecycles]);

  useEffect(() => {
    if (!payments || !keepAfterpayRequest) {
      return;
    }
    const requests = walletRequests.current;
    const initial = latest.current;
    if (initial.quote?.completeness !== "exact") {
      return;
    }
    let active = true;
    setMethodErrors((errors) => ({ ...errors, afterpay: undefined }));
    const host = walletHost("square-afterpay-container");
    void lifecycles.afterpay
      .replace(
        () => {
          const request = payments.paymentRequest({
            countryCode: "US",
            currencyCode: "USD",
            total: walletPaymentTotal(initial.quote!),
            requestShippingContact: initial.fulfillment === "ship",
            shippingContact: initial.shippingAddress
              ? contact(
                  initial.shippingAddress.name,
                  initial.buyerEmail,
                  initial.shippingAddress,
                )
              : undefined,
          });
          request.addEventListener("afterpay_shippingaddresschanged", (value) => {
            const context =
              active && requests.afterpay === request ? afterpayContext.current : null;
            if (!context) return afterpayShippingUpdate(null, value);
            try {
              context.assertCurrentBasket?.();
            } catch {
              return afterpayShippingUpdate(null, value);
            }
            context.fullAddressConfirmed = Boolean(
              context.shippingAddress &&
                matchesAfterpayAddress(value, context.shippingAddress),
            );
            return afterpayShippingUpdate(context, value);
          });
          requests.afterpay = request;
          return payments.afterpayClearpay(request);
        },
        async (method, currentGeneration) => {
          if (!method.attach) {
            throw new Error("square_afterpay_attach_unavailable");
          }
          await method.attach("#" + host.id, { useCustomButton: true });
          if (active && currentGeneration()) {
            setAfterpay(method);
          }
        },
      )
      .catch((methodError) => {
        reportUnavailable("afterpay", "create", methodError);
        if (active) {
          setMethodErrors((errors) => ({
            ...errors,
            afterpay:
              "Afterpay is unavailable for this checkout. You can retry or choose another method.",
          }));
        }
      });
    return () => {
      active = false;
      host.remove();
      setAfterpay(null);
      delete requests.afterpay;
      void lifecycles.afterpay
        .dispose()
        .catch((methodError) => reportUnavailable("afterpay", "create", methodError));
    };
  }, [payments, keepAfterpayRequest, fulfillment, methodRetries.afterpay, lifecycles]);

  useEffect(() => {
    if (!payments || !cashAppQuoteKey) {
      return;
    }
    let active = true;
    let tokenDelivered = false;
    let interaction = paymentInteraction.current;
    const current = latest.current;
    if (current.quote?.completeness !== "exact") {
      return;
    }
    setMethodErrors((errors) => ({ ...errors, cashAppPay: undefined }));
    let attached = false;
    const host = walletHost("square-cash-app-pay-container");
    void lifecycles.cashAppPay
      .replace(
        () => {
          const request = payments.paymentRequest({
            countryCode: "US",
            currencyCode: "USD",
            total: walletPaymentTotal(current.quote!),
          });
          return payments.cashAppPay(request, {
            redirectURL: window.location.href,
            referenceId: cashAppQuoteKey.slice(0, 40),
            shouldTokenize: () => {
              const ready =
                attached &&
                active &&
                latest.current.selectedMethod === "cashAppPay" &&
                !paymentInFlight.current &&
                !cashAppApproving.current &&
                latest.current.exactQuote?.quoteFingerprint === cashAppQuoteKey &&
                Boolean(latest.current.buyerEmail.trim()) &&
                Boolean(latest.current.resolvedBillingAddress) &&
                (latest.current.fulfillment === "pickup" ||
                  Boolean(latest.current.shippingAddress)) &&
                (!latest.current.isGuest || Boolean(turnstileTokenRef.current)) &&
                validateCheckoutFields(regularForm.current);
              if (ready) {
                interaction = ++paymentInteraction.current;
                tokenDelivered = false;
                cashAppApproving.current = true;
                setApprovalQuoteKey(cashAppQuoteKey);
                notifyPaymentPending.current?.(true);
                setError(null);
                setLoadingProvider("Cash App Pay");
                setProviderActive(true);
                setPaymentDialogOpen(true);
              }
              return ready;
            },
          });
        },
        async (method, currentGeneration) => {
          const continueCashApp = async (result: SquareTokenResult) => {
            const originalInteraction = interaction;
            try {
              await requireOwner?.({ waitForQuote: true });
              if (paymentInteraction.current !== originalInteraction) return;
              assertPaymentQuoteCurrent(
                cashAppQuoteKey,
                latest.current.exactQuote?.quoteFingerprint,
                latest.current.quoteReady,
              );
              if (active) void submitCashAppRef.current("cashAppPay", result);
            } catch (methodError) {
              if (paymentInteraction.current !== originalInteraction) return;
              setLoadingProvider(null);
              setError(
                methodError instanceof Error
                  ? methodError.message
                  : "Checkout changed. Please try again.",
              );
            }
          };
          method.addEventListener("ontokenization", (event) => {
            if (
              !active ||
              !attached ||
              tokenDelivered ||
              paymentInFlight.current ||
              paymentInteraction.current !== interaction
            ) {
              return;
            }
            tokenDelivered = true;
            cashAppApproving.current = false;
            setApprovalQuoteKey(null);
            notifyPaymentPending.current?.(false);
            setProviderActive(false);
            const detail = (
              event as { detail?: { tokenResult?: SquareTokenResult; error?: unknown } }
            ).detail;
            const result = detail?.tokenResult;
            if (
              !detail?.error &&
              result?.status === "OK" &&
              typeof result.token === "string" &&
              result.token.trim()
            ) {
              void continueCashApp(result);
              return;
            }
            if (detail?.error) reportUnavailable("cashAppPay", "tokenize", detail.error);
            const cancelled =
              !detail?.error &&
              (result?.status === "Cancel" || result?.status === "CANCEL");
            setLoadingProvider(null);
            setPaymentDialogOpen(false);
            setError(
              cancelled
                ? null
                : "Cash App Pay could not authorize this payment. Please try again.",
            );
          });
          await method.attach("#" + host.id, {
            shape: "semiround",
            size: "medium",
            theme: "dark",
            width: "full",
          });
          if (active && currentGeneration()) {
            attached = true;
            setCashAppPay(method);
          }
        },
      )
      .catch((methodError) => {
        reportUnavailable("cashAppPay", "create", methodError);
        if (active) {
          setMethodErrors((errors) => ({
            ...errors,
            cashAppPay:
              "Cash App Pay is unavailable for this checkout. You can retry or choose another method.",
          }));
        }
      });
    return () => {
      active = false;
      host.remove();
      setCashAppPay(null);
      void lifecycles.cashAppPay
        .dispose()
        .catch((methodError) => reportUnavailable("cashAppPay", "create", methodError));
    };
  }, [payments, cashAppQuoteKey, methodRetries.cashAppPay, lifecycles, requireOwner]);

  useEffect(() => {
    if (!isGuest || !turnstileContainer.current) {
      return;
    }
    const sitekey = clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!sitekey) {
      return;
    }
    const container = turnstileContainer.current;
    const controller = new AbortController();
    let api: TurnstileApi | undefined;
    let widgetId: string | undefined;
    let startup: number | undefined;
    let failed = false;
    const current = () => !controller.signal.aborted && !failed;
    function unavailable(code?: string) {
      if (!current()) return;
      failed = true;
      window.clearTimeout(startup);
      updateTurnstileToken(null);
      turnstileTerminalError.current = true;
      setVerificationError(
        (code && turnstileErrorMessage(code)) ||
          "The security check could not be loaded.",
      );
    }
    turnstileTokenRef.current = null;
    turnstileTerminalError.current = false;
    void loadTurnstile(controller.signal, verificationRetry)
      .then((service) => {
        if (!current()) return;
        api = service;
        startup = window.setTimeout(() => unavailable(), 15000);
        widgetId = service.render(container, {
          sitekey,
          action: "checkout_payment",
          appearance: "interaction-only",
          "before-interactive-callback": () => window.clearTimeout(startup),
          callback: (token: string) => {
            if (!current()) return;
            window.clearTimeout(startup);
            updateTurnstileToken(token);
          },
          "expired-callback": () => {
            if (current()) updateTurnstileToken(null);
          },
          "error-callback": (code: string) => unavailable(code),
        });
        setTurnstileWidget(widgetId);
      })
      .catch(() => unavailable());
    return () => {
      controller.abort();
      window.clearTimeout(startup);
      if (widgetId !== undefined) api?.remove(widgetId);
    };
  }, [isGuest, verificationRetry]);

  async function pay(
    checkout: PreparedCheckout,
    authorization: { permit: string; sourceId: string },
  ) {
    await requireOwner?.();
    checkout.assertCurrentBasket?.();
    setLoadingProvider(null);
    setPaymentDialogOpen(true);
    const paymentRequest = new AbortController();
    // Once the request leaves the tab, losing even its response headers requires status recovery.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timeout = setTimeout(() => {
        paymentRequest.abort();
        resolve(null);
      }, 10_000);
    });
    let response: Response | null;
    try {
      response = await Promise.race([
        fetch("/api/checkout/pay", {
          method: "POST",
          signal: paymentRequest.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(authorization),
        }).catch(() => null),
        deadline,
      ]);
    } finally {
      clearTimeout(timeout);
    }

    const data =
      response && !response.ok && (response.status < 500 || response.status === 503)
        ? await readUnavailablePayment(response, paymentRequest)
        : null;
    await requireOwner?.();
    checkout.assertFinancialAttempt?.();
    if (response && data) {
      if (
        ([400, 401, 402, 403, 409].includes(response.status) &&
          typeof data?.error === "string" &&
          data.status !== "UNKNOWN") ||
        data?.code === "PAYMENT_NOT_SUBMITTED"
      )
        throw Error(data?.error || "Payment could not be completed");
    }
    onProcessing(checkout.orderId, checkout.transientGuestAccessToken);
    router.replace(
      "/checkout/processing?orderId=" + encodeURIComponent(checkout.orderId),
    );
  }

  function permitOptions(checkout: PreparedCheckout, method: PaymentMethod) {
    checkout.assertCurrentBasket?.();
    return {
      onExistingPaymentReview: async (): Promise<never> => {
        await requireOwner?.();
        checkout.assertFinancialAttempt?.();
        onProcessing(checkout.orderId, checkout.transientGuestAccessToken);
        router.replace(
          "/checkout/processing?orderId=" + encodeURIComponent(checkout.orderId),
        );
        throw new ExistingOrderHandoff();
      },
      permitRequest: {
        orderId: checkout.orderId,
        guestAccessToken: checkout.guestAccessToken,
        deviceSessionId: checkout.deviceSessionId,
        method,
        turnstileToken: isGuest ? turnstileTokenRef.current : undefined,
      },
    };
  }

  function assertPayable(requireVisibleExactQuote: boolean): void {
    if (requireVisibleExactQuote && !exactQuote) {
      throw new Error("Complete the address to calculate your total.");
    }
    if (isGuest && !turnstileTokenRef.current) {
      throw new Error("Complete the security check before paying.");
    }
  }

  async function runPayment(
    action: () => Promise<void>,
    requireVisibleExactQuote = true,
  ) {
    if (paymentInFlight.current || cashAppApproving.current) {
      return;
    }
    paymentInteraction.current++;
    paymentInFlight.current = true;
    // Checkout owns focus until this interaction opens its own provider UI.
    setProviderActive(false);
    performance.clearMarks("checkout-payment-start");
    performance.clearMarks("checkout-confirmed");
    performance.clearMeasures("checkout-click-to-confirmed");
    performance.mark("checkout-payment-start");
    cardInputError.current = false;
    setAddressReview(null);
    setCartRecovery(false);
    setIsPaying(true);
    onPaymentPending?.(true);
    setPaymentDialogOpen(true);
    setError(null);
    try {
      await requireOwner?.();
      assertPayable(requireVisibleExactQuote);
      await action();
    } catch (paymentError) {
      if (paymentError instanceof ExistingOrderHandoff) return;
      onPaymentPending?.(false);
      paymentInFlight.current = false;
      setCartRecovery(paymentError instanceof CheckoutCartUnavailable);
      if (paymentError instanceof CheckoutCancelled) {
        setWalletReview(null);
        setAddressReview(null);
        setTotalReview(null);
        setPaymentDialogOpen(false);
        setError(null);
        setIsPaying(false);
        return;
      }
      setPaymentDialogOpen(!cardInputError.current);
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : "Payment could not be completed",
      );
      setIsPaying(false);
    } finally {
      afterpayContext.current = null;
      setLoadingProvider(null);
      updateTurnstileToken(null);
      if (turnstileWidget && window.turnstile && !turnstileTerminalError.current) {
        window.turnstile.reset(turnstileWidget);
      }
    }
  }

  function dismissPaymentDialog() {
    paymentInteraction.current++;
    const walletChoice = walletContinuation.current;
    walletContinuation.current = null;
    walletChoice?.(null);
    const addressChoice = addressContinuation.current;
    addressContinuation.current = null;
    addressChoice?.(null);
    const totalChoice = totalContinuation.current;
    totalContinuation.current = null;
    totalChoice?.(false);
    cashAppCancellation.current?.();
    if (!paymentInFlight.current) {
      setPaymentDialogOpen(false);
    }
  }

  function selectMethod(method: typeof selectedMethod) {
    if (method !== "cashAppPay" && cashAppApproving.current) {
      // Retire this approval and its SDK listener before another method starts.
      paymentInteraction.current++;
      cashAppApproving.current = false;
      setApprovalQuoteKey(null);
      setMethodRetries((value) => ({ ...value, cashAppPay: value.cashAppPay + 1 }));
      notifyPaymentPending.current?.(false);
      setProviderActive(false);
      setLoadingProvider(null);
      setPaymentDialogOpen(false);
    }
    setSelectedMethod(method);
  }

  async function prepareOrder(
    method: PaymentMethod,
    context: CheckoutPreparationContext,
  ) {
    setPreparing(true);
    try {
      return await prepare(method, context);
    } finally {
      setPreparing(false);
    }
  }

  async function prepareWithAddressReview(method: PaymentMethod) {
    let currentQuote = exactQuote!;
    let currentAddress = shippingAddress;
    let currentBilling = resolvedBillingAddress!;
    let shippingConfirmation: string | undefined;
    let shippingAddressOverride = false;
    for (;;) {
      try {
        const checkout = await prepareOrder(method, {
          quote: currentQuote,
          shippingAddress: currentAddress ?? undefined,
          billingAddress: currentBilling,
          shippingConfirmation,
          shippingAddressOverride,
        });
        return {
          checkout,
          quote: currentQuote,
          address: currentAddress,
          billing: currentBilling,
        };
      } catch (failure) {
        if (
          !(failure instanceof ShippingAddressValidationError) ||
          failure.code === "SHIPPING_ADDRESS_UNAVAILABLE"
        ) {
          throw failure;
        }
        requireReviewOwner();
        setAddressReview(failure);
        setPaymentDialogOpen(true);
        const choice = await new Promise<{
          address: ShippingAddress;
          confirmation?: string;
          override?: boolean;
        } | null>((resolve) => {
          addressContinuation.current = resolve;
        });
        if (!choice) {
          throw new CheckoutCancelled();
        }
        requireReviewOwner();
        const previousTotal = currentQuote.totals.totalCents;
        const context = await resolveWalletShippingContactRef.current(
          { ...choice.address, line2: choice.address.line2 ?? null },
          buyerEmail,
        );
        currentQuote = context.quote;
        currentAddress = context.shippingAddress;
        shippingConfirmation = choice.confirmation;
        shippingAddressOverride = choice.override === true;
        if (sameAsShipping) {
          currentBilling = resolveBillingAddress({
            fulfillment,
            sameAsShipping: true,
            shippingAddress: currentAddress,
            billingAddress,
          })!;
        }
        if (currentQuote.totals.totalCents !== previousTotal) {
          requireReviewOwner();
          setTotalReview(currentQuote.totals.totalCents);
          const accepted = await new Promise<boolean>((resolve) => {
            totalContinuation.current = resolve;
          });
          if (!accepted) {
            throw new CheckoutCancelled();
          }
          requireReviewOwner();
        }
      }
    }
  }

  async function reauthorizeCashApp(updatedQuote: ExactCheckoutQuote): Promise<string> {
    if (!payments) {
      throw new Error("Cash App Pay is unavailable. Please try again.");
    }
    flushSync(() => setCashAppReapproval(true));
    const host = walletHost("cash-app-address-confirmation");
    const lifecycle = createSquareMethodLifecycle<SquareCashAppPayMethod>();
    let ready = false;
    try {
      return await new Promise<string>((resolve, reject) => {
        cashAppCancellation.current = () => reject(new CheckoutCancelled());
        void lifecycle
          .replace(
            () =>
              payments.cashAppPay(
                payments.paymentRequest({
                  countryCode: "US",
                  currencyCode: "USD",
                  total: walletPaymentTotal(updatedQuote),
                }),
                {
                  redirectURL: window.location.href,
                  referenceId: updatedQuote.quoteFingerprint.slice(0, 40),
                  shouldTokenize: () => ready,
                },
              ),
            async (method, current) => {
              method.addEventListener("ontokenization", (event) => {
                if (!ready || !current()) return;
                const detail = (event as { detail?: { tokenResult?: SquareTokenResult } })
                  .detail;
                try {
                  resolve(checkedToken(detail?.tokenResult ?? { status: "ERROR" }));
                } catch (failure) {
                  reject(failure);
                }
              });
              await method.attach("#" + host.id, { width: "full", theme: "dark" });
              ready = current();
            },
          )
          .catch((failure) => {
            reportUnavailable("cashAppPay", "attach", failure);
            reject(
              new Error(
                "Cash App Pay could not load the updated amount. Return to checkout and try again.",
              ),
            );
          });
      });
    } finally {
      ready = false;
      cashAppCancellation.current = null;
      host.remove();
      setCashAppReapproval(false);
      void lifecycle
        .dispose()
        .catch((failure) => reportUnavailable("cashAppPay", "attach", failure));
    }
  }

  async function submitTokenizedWallet(method: PaymentMethod, result: SquareTokenResult) {
    if (!validateCheckoutFields(regularForm.current)) {
      setLoadingProvider(null);
      setPaymentDialogOpen(false);
      setError("Check the highlighted fields before continuing.");
      return;
    }
    await runPayment(async () => {
      let sourceId = checkedToken(result);
      if (!resolvedBillingAddress) {
        throw new Error("Enter your billing address to continue.");
      }
      const prepared = await prepareWithAddressReview(method);
      setPaymentDialogOpen(true);
      const { checkout } = prepared;
      if (prepared.quote.totals.totalCents !== exactQuote?.totals.totalCents) {
        await requireOwner?.();
        sourceId = await reauthorizeCashApp(prepared.quote);
      }
      await requireOwner?.();
      await pay(
        checkout,
        await authorizeTokenizedSource({
          ...permitOptions(checkout, method),
          sourceId,
        }),
      );
    });
  }

  function submitWallet(method: "applePay", wallet: SquarePaymentMethod) {
    if (
      paymentInFlight.current ||
      !quoteReady ||
      !quote ||
      (isGuest && !turnstileToken)
    ) {
      return;
    }
    const request = walletRequests.current[method];
    if (!request) {
      return;
    }
    try {
      updateSquarePaymentRequest(request, {
        total: walletPaymentTotal(quote),
        requestShippingContact: fulfillment === "ship",
        requestBillingContact: true,
      });
    } catch (walletError) {
      paymentInteraction.current++;
      setProviderActive(false);
      setLoadingProvider(null);
      setPaymentDialogOpen(true);
      setError(
        walletError instanceof Error
          ? walletError.message
          : "Payment details could not be updated.",
      );
      return;
    }
    walletQuote.current = null;
    void runPayment(async () => {
      flushSync(() => setProviderActive(true));
      let result: Awaited<ReturnType<typeof wallet.tokenize>>;
      try {
        result = await wallet.tokenize();
      } finally {
        setProviderActive(false);
      }

      setPaymentDialogOpen(true);
      const sourceId = checkedToken(result);
      let walletBilling = walletBillingAddress(result.details?.billing);
      const contactEmail =
        result.details?.shipping?.contact?.email ?? result.details?.billing?.email;
      let walletEmail = (!isGuest ? buyerEmail : buyerEmail.trim() || contactEmail || "")
        .trim()
        .toLowerCase();
      let walletPickup =
        fulfillment === "pickup"
          ? {
              name:
                pickupContact?.name.trim() ||
                [result.details?.billing?.givenName, result.details?.billing?.familyName]
                  .filter(Boolean)
                  .join(" "),
              phone: pickupContact?.phone.trim() || result.details?.billing?.phone || "",
            }
          : null;
      const tokenShipping = result.details?.shipping?.contact;
      const shippingDraft =
        fulfillment === "ship"
          ? {
              name: [tokenShipping?.givenName, tokenShipping?.familyName]
                .filter(Boolean)
                .join(" "),
              phone: tokenShipping?.phone ?? "",
              line1: tokenShipping?.addressLines?.[0] ?? "",
              line2: tokenShipping?.addressLines?.[1] ?? null,
              city: tokenShipping?.city ?? "",
              state: tokenShipping?.state ?? "",
              postalCode: tokenShipping?.postalCode ?? "",
              country: tokenShipping?.countryCode ?? "",
            }
          : null;
      // The wallet-only address exception requires a complete provider destination.
      // Only recipient name/phone may be completed in our continuation form.
      if (
        shippingDraft &&
        !checkoutShippingAddressSchema
          .omit({ name: true, phone: true })
          .strip()
          .safeParse(shippingDraft).success
      ) {
        throw new Error("Choose a complete US shipping address in your wallet.");
      }
      const parsedShipping = checkoutShippingAddressSchema.safeParse(shippingDraft);
      let walletShipping: CheckoutPaymentAddress | null = parsedShipping.success
        ? { ...parsedShipping.data, line2: parsedShipping.data.line2 ?? null }
        : null;
      if (
        !walletBilling ||
        !checkoutEmailSchema.safeParse(walletEmail).success ||
        (fulfillment === "ship" && !walletShipping) ||
        (fulfillment === "pickup" &&
          !checkoutPickupContactSchema.safeParse(walletPickup).success)
      ) {
        requireReviewOwner();
        const billingContact = result.details?.billing;
        setWalletReview({
          buyerEmail: walletEmail,
          pickupContact: walletPickup,
          needsBilling: !walletBilling,
          shippingAddress: walletShipping ? null : shippingDraft,
          billingAddress: walletBilling
            ? {
                ...walletBilling,
                line2: walletBilling.line2 ?? "",
                phone: walletBilling.phone ?? "",
              }
            : {
                givenName: billingContact?.givenName ?? "",
                familyName: billingContact?.familyName ?? "",
                phone: billingContact?.phone ?? "",
                line1: billingContact?.addressLines?.[0] ?? "",
                line2: billingContact?.addressLines?.[1] ?? "",
                city: billingContact?.city ?? "",
                state: billingContact?.state ?? "",
                postalCode: billingContact?.postalCode ?? "",
                country: billingContact?.countryCode ?? "US",
              },
        });
        const completed = await new Promise<WalletDetails | null>((resolve) => {
          walletContinuation.current = resolve;
        });
        if (!completed) throw new CheckoutCancelled();
        requireReviewOwner();
        walletBilling = completed.billingAddress;
        walletEmail = completed.buyerEmail;
        walletPickup = completed.pickupContact;
        walletShipping = completed.shippingAddress ?? walletShipping;
      }
      let checkoutContext: CheckoutPreparationContext = {
        billingAddress: walletBilling,
        buyerEmail: walletEmail,
        pickupContact: walletPickup,
      };
      if (fulfillment === "ship") {
        const shippingContext = await resolveWalletShippingContactRef.current(
          walletShipping!,
          walletEmail,
        );
        assertWalletTotalUnchanged(
          walletQuote.current ?? exactQuote,
          shippingContext.quote,
        );
        checkoutContext = { ...shippingContext, billingAddress: walletBilling };
      }
      const checkout = await prepareOrder(method, checkoutContext);
      await requireOwner?.();
      await pay(
        checkout,
        await authorizeTokenizedSource({
          ...permitOptions(checkout, method),
          sourceId,
        }),
      );
    }, false);
  }

  function submitPreparedMethod(
    method: "card" | "afterpay",
    payment: SquarePaymentMethod,
  ) {
    void runPayment(async () => {
      setLoadingProvider(method === "afterpay" ? "Afterpay" : null);
      if (method === "card" && !cardholderName.trim()) {
        cardholderNameInput.current?.reportValidity();
        throw new Error("Enter the name shown on the card.");
      }
      if (!resolvedBillingAddress) {
        billingFields.current
          ?.querySelector<
            HTMLInputElement | HTMLSelectElement
          >("input:invalid, select:invalid")
          ?.reportValidity();
        throw new Error("Enter a complete US billing address.");
      }
      const originalRequest =
        method === "afterpay" ? walletRequests.current.afterpay : undefined;
      const prepared = await prepareWithAddressReview(method);
      setPaymentDialogOpen(true);
      const { checkout } = prepared;
      const paymentBilling = prepared.billing;
      if (method === "afterpay") {
        const request = walletRequests.current.afterpay;
        if (!request || request !== originalRequest) {
          throw new Error("Afterpay is still loading. Please try again.");
        }
        afterpayContext.current = {
          fulfillment,
          quote: prepared.quote,
          shippingAddress: prepared.address,
          assertCurrentBasket: checkout.assertCurrentBasket,
        };
        updateSquarePaymentRequest(request, {
          total: walletPaymentTotal(prepared.quote),
          requestShippingContact: fulfillment === "ship",
          shippingContact: prepared.address
            ? contact(prepared.address.name, buyerEmail, prepared.address)
            : undefined,
        });
      }
      const buyer = squareBillingContact({
        cardholderName:
          method === "card"
            ? cardholderName
            : `${paymentBilling.givenName} ${paymentBilling.familyName}`,
        buyerEmail,
        billingAddress: paymentBilling,
      });
      await requireOwner?.();
      await pay(
        checkout,
        await authorizeAndTokenize({
          ...permitOptions(checkout, method),
          paymentMethod: {
            tokenize: async (details) => {
              await requireOwner?.();
              checkout.assertCurrentBasket?.();
              if (
                method === "afterpay" &&
                walletRequests.current.afterpay !== originalRequest
              )
                throw new Error("Afterpay changed. Review your order before continuing.");
              // Let Square own focus while its verification or wallet UI is open.
              flushSync(() => setProviderActive(true));
              try {
                const result = await payment.tokenize(details);
                if (result.status === "CANCEL") throw new CheckoutCancelled();
                if (
                  method === "afterpay" &&
                  fulfillment === "ship" &&
                  result.status === "OK"
                ) {
                  const returnedAddress = result.details?.shipping?.contact;
                  const addressMatches = Boolean(
                    prepared.address &&
                      matchesAfterpayTokenAddress(
                        returnedAddress,
                        prepared.address,
                        afterpayContext.current?.fullAddressConfirmed === true,
                      ),
                  );
                  if (!addressMatches)
                    throw new Error(
                      "Afterpay did not confirm your shipping address. Return to checkout and review it.",
                    );
                }
                if (method === "card" && result.status === "INVALID") {
                  cardInputError.current = true;
                  cardState.showTokenErrors(result.errors);
                }
                return result;
              } finally {
                setProviderActive(false);
                setPaymentDialogOpen(!cardInputError.current);
              }
            },
          },
          verificationDetails:
            method === "card"
              ? {
                  amount: money(checkout.totals.totalCents),
                  currencyCode: "USD",
                  intent: "CHARGE",
                  customerInitiated: true,
                  sellerKeyedIn: false,
                  billingContact: buyer,
                }
              : undefined,
        }),
      );
    });
  }

  const disabled = !exactQuote || isPaying || (isGuest && !turnstileToken);
  const selectedPayment = selectedMethod === "card" ? card : afterpay;
  const cashAppDisabled =
    disabled ||
    !cashAppPay ||
    !resolvedBillingAddress ||
    !buyerEmail.trim() ||
    (fulfillment === "ship" && !shippingAddress);
  const payLabel = exactQuote
    ? `Pay $${money(exactQuote.totals.totalCents)} now`
    : "Pay now";

  function submitRegularPayment() {
    if (paymentInFlight.current || recoveryRequired) {
      return;
    }
    setError(null);
    const fieldsValid = validateCheckoutFields(regularForm.current);
    if (!fieldsValid) {
      return;
    }
    if (!exactQuote) {
      setError("Wait for your total to update before continuing.");
      return;
    }
    if (isGuest && !turnstileTokenRef.current) {
      setError("Complete the security check before paying.");
      return;
    }
    if (selectedMethod === "cashAppPay") {
      setError("Continue using the Cash App Pay button once it is ready.");
    } else if (selectedPayment) {
      submitPreparedMethod(selectedMethod, selectedPayment);
    } else {
      setError("Your payment method is still loading. Please try again.");
    }
  }

  return (
    <>
      <CheckoutPaymentDialog
        open={!accessSuspended && paymentDialogOpen}
        preparing={preparing}
        cartRecovery={cartRecovery}
        providerActive={providerActive}
        loadingProvider={loadingProvider}
        walletReview={
          canShowReview && walletReview ? (
            <CheckoutWalletDetails
              initial={walletReview}
              onContinue={(details) => {
                if (!canActOnReview()) return;
                const continuation = walletContinuation.current;
                walletContinuation.current = null;
                setWalletReview(null);
                continuation?.(details);
              }}
            />
          ) : null
        }
        addressReview={canShowReview ? addressReview : null}
        onAcceptAddress={(address, confirmation, override) => {
          if (!canActOnReview()) return;
          const continuation = addressContinuation.current;
          if (!continuation) {
            return;
          }
          addressContinuation.current = null;
          setAddressReview(null);
          setError(null);
          continuation({ address, confirmation, override });
        }}
        totalReview={canShowReview ? totalReview : null}
        onConfirmTotal={() => {
          if (!canActOnReview()) return;
          const continuation = totalContinuation.current;
          totalContinuation.current = null;
          setTotalReview(null);
          continuation?.(true);
        }}
        cashAppReapproval={cashAppReapproval}
        error={error}
        onDismiss={() => {
          if (canActOnReview()) dismissPaymentDialog();
        }}
      />
      <ExpressCheckoutMethods
        payDescriptionId={unavailableVerificationId}
        onRetry={appleLoadError ? () => setAppleRetry((n) => n + 1) : undefined}
        applePayReady={Boolean(applePay)}
        disabled={isPaying || !quoteReady || (isGuest && !turnstileToken)}
        loading={expressLoading}
        onApplePayClick={() => applePay && submitWallet("applePay", applePay)}
      />

      <form
        ref={regularForm}
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          submitRegularPayment();
        }}
      >
        <div className="contents" inert={isPaying}>
          {children}
        </div>

        <CheckoutPaymentPanel
          payDescriptionId={unavailableVerificationId}
          loadingProvider={loadingProvider}
          selectedMethod={selectedMethod}
          cardHost={cardHost}
          cardLoading={!card && !cardLoadError}
          cardLoadError={cardLoadError}
          onRetryCard={() => {
            if (paymentInFlight.current || !cardLoadError) return;
            setCardLoadError(false);
            if (payments) setCardRetry((n) => n + 1);
            else setSdkRetry((n) => n + 1);
          }}
          cardBrand={cardState.brand}
          cardErrors={cardState.errors}
          afterpayReady={Boolean(afterpay)}
          cashAppPayReady={Boolean(cashAppPay) && !disabled}
          methodMessage={
            selectedMethod === "card"
              ? null
              : fulfillment === "ship" && !shippingAddress
                ? "Enter your shipping address to continue."
                : !buyerEmail.trim()
                  ? "Enter your email to continue."
                  : !resolvedBillingAddress
                    ? "Enter your billing address to continue."
                    : !exactQuote
                      ? "Updating your total�"
                      : (methodErrors[selectedMethod] ??
                        ((selectedMethod === "cashAppPay" ? !cashAppPay : !afterpay)
                          ? "Loading payment method�"
                          : isGuest && !turnstileToken
                            ? unavailableVerificationId
                              ? null
                              : "Complete the security check to continue."
                            : null))
          }
          onRetryMethod={
            selectedMethod !== "card" && methodErrors[selectedMethod]
              ? () =>
                  setMethodRetries((value) => ({
                    ...value,
                    [selectedMethod]: value[selectedMethod] + 1,
                  }))
              : undefined
          }
          fulfillment={fulfillment}
          sameAsShipping={sameAsShipping}
          cardholderName={cardholderName}
          billingAddress={billingAddress}
          isPaying={isPaying}
          payDisabled={
            isPaying ||
            recoveryRequired ||
            (isGuest && !turnstileToken) ||
            !quoteReady ||
            (selectedMethod === "card" && !card)
          }
          cashAppCanPay={!cashAppDisabled}
          payLabel={selectedMethod === "afterpay" ? "Continue with Afterpay" : payLabel}
          error={paymentDialogOpen ? null : error}
          cardholderNameInput={cardholderNameInput}
          billingFields={billingFields}
          securityChallenge={
            isGuest ? (
              <>
                <div
                  id="checkout-turnstile-container"
                  ref={turnstileContainer}
                  className="mt-4"
                />
                {unavailableVerificationId && (
                  <p id={unavailableVerificationId} role="status">
                    Guest checkout verification is temporarily unavailable. Please try
                    again later.
                  </p>
                )}
                {clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY &&
                  !turnstileToken &&
                  !verificationError && (
                    <p role="status">
                      {turnstileWidget === null
                        ? "Loading security check…"
                        : "Complete the security check to continue."}
                    </p>
                  )}
                {verificationError && (
                  <div>
                    <p role="status">{verificationError}</p>
                    <button
                      type="button"
                      className="min-h-11 underline"
                      onClick={() => {
                        setVerificationError(null);
                        setTurnstileWidget(null);
                        setVerificationRetry((n) => n + 1);
                      }}
                    >
                      Retry security check
                    </button>
                  </div>
                )}
              </>
            ) : null
          }
          onSelectMethod={selectMethod}
          onSameAsShippingChange={setSameAsShipping}
          onCardholderNameChange={setCardholderName}
          onBillingAddressChange={(field, value) =>
            setBillingAddress((current) => ({ ...current, [field]: value }))
          }
          onPay={submitRegularPayment}
        />
      </form>
    </>
  );
}
