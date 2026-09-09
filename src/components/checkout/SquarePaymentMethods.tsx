"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  EMPTY_BILLING_ADDRESS,
  type CheckoutBillingAddressForm,
} from "@/components/checkout/BillingAddressFields";
import { CheckoutPaymentPanel } from "@/components/checkout/CheckoutPaymentPanel";
import { ExpressCheckoutMethods } from "@/components/checkout/ExpressCheckoutMethods";
import { initializeSquareCard } from "@/components/checkout/square-card-initialization";
import {
  squarePaymentDiagnostic,
  type SquarePaymentPhase,
} from "@/components/checkout/square-payment-diagnostics";
import {
  createSquareMethodLifecycle,
  updateSquarePaymentRequest,
  assertPaymentQuoteCurrent,
} from "@/components/checkout/square-method-lifecycle";
import { clientEnv } from "@/config/client-env";
import type { CheckoutPageData } from "@/lib/checkout/checkout-page-data";
import type {
  CheckoutQuoteResponse,
  CheckoutBillingAddress,
  ExactCheckoutQuote,
  PaymentPermitRequest,
} from "@/lib/checkout/checkout-request";
import {
  checkoutBillingAddressSchema,
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
import { log } from "@/lib/utils/log";

export type PaymentMethod = PaymentPermitRequest["method"];

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
  orderId: string;
  guestAccessToken?: string;
  deviceSessionId: string;
  totals: ExactCheckoutQuote["totals"];
};

export type WalletCheckoutContext = {
  quote: ExactCheckoutQuote;
  shippingAddress: CheckoutPaymentAddress;
  buyerEmail?: string;
};

export type CheckoutPreparationContext = {
  quote?: ExactCheckoutQuote;
  shippingAddress?: CheckoutPaymentAddress;
  buyerEmail?: string;
  billingAddress?: CheckoutBillingAddress | null;
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

export function walletBillingAddress(value: unknown): CheckoutBillingAddress | null {
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
        taxLineItems: [{ label: "Tax", amount: money(quote.totals.taxCents) }],
        total: { label: "Total", amount: money(quote.totals.totalCents) },
      },
    ],
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
): void {
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

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    const script = existing ?? document.createElement("script");
    const loaded = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error("turnstile_unavailable"));
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", () => reject(new Error("turnstile_unavailable")), {
      once: true,
    });
    if (!existing) {
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export function SquarePaymentMethods({
  paymentConfig,
  quote,
  quoteReady = true,
  fulfillment,
  buyerEmail,
  shippingAddress,
  isGuest,
  quoteWalletShippingDestination,
  resolveWalletShippingContact,
  prepare,
  clearCart,
  children,
}: {
  paymentConfig: CheckoutPageData["paymentConfig"];
  quote: CheckoutQuoteResponse | null;
  quoteReady?: boolean;
  fulfillment: "ship" | "pickup";
  buyerEmail: string;
  shippingAddress: CheckoutPaymentAddress | null;
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
  clearCart(): void;
  children?: ReactNode;
}) {
  const exactQuote = quoteReady && quote?.completeness === "exact" ? quote : null;
  const [payments, setPayments] = useState<Awaited<
    ReturnType<typeof loadSquareWebPayments>
  > | null>(null);
  const [card, setCard] = useState<SquarePaymentMethod | null>(null);
  const [applePay, setApplePay] = useState<SquarePaymentMethod | null>(null);
  const [googlePay, setGooglePay] = useState<SquarePaymentMethod | null>(null);
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
  const [turnstileWidget, setTurnstileWidget] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expressLoading, setExpressLoading] = useState(true);
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const cardholderNameInput = useRef<HTMLInputElement>(null);
  const billingFields = useRef<HTMLDivElement>(null);
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
    googlePay: createSquareMethodLifecycle<SquarePaymentMethod>(),
    cashAppPay: createSquareMethodLifecycle<SquareCashAppPayMethod>(),
    afterpay: createSquareMethodLifecycle<SquarePaymentMethod>(),
  }));
  const walletRequests = useRef<
    Partial<Record<"applePay" | "googlePay" | "afterpay", SquarePaymentRequest>>
  >({});
  const paymentInFlight = useRef(false);
  const latest = useRef({
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
  const hasAfterpayQuote = quote?.completeness === "exact";
  const cashAppQuoteKey = quote?.completeness === "exact" ? quote.quoteFingerprint : null;
  const afterpayContext = useRef<{
    quote: ExactCheckoutQuote;
    shippingAddress: CheckoutPaymentAddress | null;
  } | null>(null);

  function updateTurnstileToken(token: string | null) {
    turnstileTokenRef.current = token;
    setTurnstileToken(token);
  }

  useEffect(() => {
    let active = true;
    let nextCard: SquarePaymentMethod | null = null;
    let phase: SquarePaymentPhase = "load";
    void (async () => {
      try {
        const nextPayments = await loadSquareWebPayments(paymentConfig);
        nextCard = await initializeSquareCard(
          nextPayments,
          (readyPayments) => {
            if (active) {
              setPayments(readyPayments);
            }
          },
          (nextPhase) => {
            phase = nextPhase;
          },
        );
        if (active) {
          setCard(nextCard);
        }
      } catch (caughtError) {
        reportUnavailable("card", phase, caughtError);
        if (active) {
          setError("Secure payment fields could not be loaded. Please retry.");
          if (phase === "load") {
            setExpressLoading(false);
          }
        }
      }
    })();
    return () => {
      active = false;
      void nextCard?.destroy?.();
    };
  }, [paymentConfig.applicationId, paymentConfig.environment, paymentConfig.locationId]);

  useEffect(() => {
    if (!payments || !hasQuote || !latest.current.quote) {
      return;
    }
    let active = true;
    setExpressLoading(true);
    const initialQuote = latest.current.quote;
    const initialize = (name: "applePay" | "googlePay") => {
      return lifecycles[name]
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
            );
            walletRequests.current[name] = request;
            return payments[name](request);
          },
          async (method) => {
            if (name === "googlePay") {
              if (!method.attach) {
                throw new Error("square_google_pay_attach_unavailable");
              }
              await method.attach("#square-google-pay-container", {
                buttonSizeMode: "fill",
              });
            }
            if (active) {
              if (name === "applePay") {
                setApplePay(method);
              } else {
                setGooglePay(method);
              }
            }
          },
        )
        .catch((methodError) => {
          reportUnavailable(name, "create", methodError);
        });
    };
    void Promise.allSettled([initialize("applePay"), initialize("googlePay")]).then(
      () => {
        if (active) {
          setExpressLoading(false);
        }
      },
    );
    return () => {
      active = false;
      setApplePay(null);
      setGooglePay(null);
      for (const name of ["applePay", "googlePay"] as const) {
        delete walletRequests.current[name];
        void lifecycles[name]
          .dispose()
          .catch((methodError) => reportUnavailable(name, "create", methodError));
      }
    };
  }, [payments, hasQuote, lifecycles]);

  useEffect(() => {
    if (!payments || !hasAfterpayQuote) {
      return;
    }
    const initial = latest.current;
    if (initial.quote?.completeness !== "exact") {
      return;
    }
    let active = true;
    setMethodErrors((errors) => ({ ...errors, afterpay: undefined }));
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
            const context = afterpayContext.current;
            const destination = value as {
              countryCode?: string;
              state?: string;
              postalCode?: string;
            };
            if (
              !context?.shippingAddress ||
              destination.countryCode !== "US" ||
              destination.state !== context.shippingAddress.state ||
              destination.postalCode !== context.shippingAddress.postalCode
            ) {
              return {
                error: "Use the shipping address confirmed on the checkout page.",
              };
            }
            return walletShippingUpdate(context.quote);
          });
          walletRequests.current.afterpay = request;
          return payments.afterpayClearpay(request);
        },
        async (method) => {
          if (!method.attach) {
            throw new Error("square_afterpay_attach_unavailable");
          }
          await method.attach("#square-afterpay-container", { useCustomButton: true });
          if (active) {
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
      setAfterpay(null);
      delete walletRequests.current.afterpay;
      void lifecycles.afterpay
        .dispose()
        .catch((methodError) => reportUnavailable("afterpay", "create", methodError));
    };
  }, [payments, hasAfterpayQuote, methodRetries.afterpay, lifecycles]);

  useEffect(() => {
    if (!payments || !cashAppQuoteKey) {
      return;
    }
    let active = true;
    const current = latest.current;
    if (current.quote?.completeness !== "exact") {
      return;
    }
    setMethodErrors((errors) => ({ ...errors, cashAppPay: undefined }));
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
            shouldTokenize: () =>
              active &&
              !paymentInFlight.current &&
              latest.current.exactQuote?.quoteFingerprint === cashAppQuoteKey &&
              Boolean(latest.current.buyerEmail.trim()) &&
              Boolean(latest.current.resolvedBillingAddress) &&
              (latest.current.fulfillment === "pickup" ||
                Boolean(latest.current.shippingAddress)) &&
              (!latest.current.isGuest || Boolean(turnstileTokenRef.current)),
          });
        },
        async (method) => {
          method.addEventListener("ontokenization", (event) => {
            if (!active) {
              return;
            }
            const detail = (
              event as { detail?: { tokenResult?: SquareTokenResult; error?: unknown } }
            ).detail;
            if (detail?.error) {
              reportUnavailable("cashAppPay", "tokenize", detail.error);
              setError(
                "Cash App Pay could not authorize this payment. Please try again.",
              );
            } else if (detail?.tokenResult) {
              try {
                assertPaymentQuoteCurrent(
                  cashAppQuoteKey,
                  latest.current.exactQuote?.quoteFingerprint,
                  latest.current.quoteReady,
                );
                void submitCashAppRef.current("cashAppPay", detail.tokenResult);
              } catch (methodError) {
                setError(
                  methodError instanceof Error
                    ? methodError.message
                    : "Checkout changed. Please try again.",
                );
              }
            }
          });
          await method.attach("#square-cash-app-pay-container");
          if (active) {
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
      setCashAppPay(null);
      void lifecycles.cashAppPay
        .dispose()
        .catch((methodError) => reportUnavailable("cashAppPay", "create", methodError));
    };
  }, [payments, cashAppQuoteKey, methodRetries.cashAppPay, lifecycles]);

  useEffect(() => {
    if (!isGuest || !turnstileContainer.current) {
      return;
    }
    const sitekey = clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!sitekey) {
      setError("Guest checkout verification is temporarily unavailable.");
      return;
    }
    let widgetId: string | null = null;
    void loadTurnstile()
      .then((api) => {
        if (!turnstileContainer.current) {
          return;
        }
        widgetId = api.render(turnstileContainer.current, {
          sitekey,
          action: "checkout_payment",
          appearance: "interaction-only",
          callback: (token: string) => updateTurnstileToken(token),
          "expired-callback": () => updateTurnstileToken(null),
          "error-callback": (code: string) => {
            updateTurnstileToken(null);
            const message = turnstileErrorMessage(code);
            if (message) {
              turnstileTerminalError.current = true;
              setError(message);
            }
          },
        });
        setTurnstileWidget(widgetId);
      })
      .catch(() => setError("Guest checkout verification is temporarily unavailable."));
    return () => {
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [isGuest]);

  async function pay(authorization: { permit: string; sourceId: string }) {
    const response = await fetch("/api/checkout/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authorization),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || typeof data?.statusUrl !== "string") {
      throw new Error(data?.error || "Payment could not be completed");
    }
    clearCart();
    window.location.assign(data.statusUrl);
  }

  function permitRequest(checkout: PreparedCheckout, method: PaymentMethod) {
    return {
      orderId: checkout.orderId,
      guestAccessToken: checkout.guestAccessToken,
      deviceSessionId: checkout.deviceSessionId,
      method,
      turnstileToken: isGuest ? turnstileTokenRef.current : undefined,
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
    if (paymentInFlight.current) {
      return;
    }
    paymentInFlight.current = true;
    setIsPaying(true);
    setError(null);
    try {
      assertPayable(requireVisibleExactQuote);
      await action();
    } catch (paymentError) {
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : "Payment could not be completed",
      );
      setIsPaying(false);
    } finally {
      paymentInFlight.current = false;
      updateTurnstileToken(null);
      if (turnstileWidget && window.turnstile && !turnstileTerminalError.current) {
        window.turnstile.reset(turnstileWidget);
      }
    }
  }

  async function submitTokenizedWallet(method: PaymentMethod, result: SquareTokenResult) {
    await runPayment(async () => {
      const sourceId = checkedToken(result);
      if (!resolvedBillingAddress) {
        throw new Error("Enter your billing address to continue.");
      }
      const checkout = await prepare(method, { billingAddress: resolvedBillingAddress });
      await pay(
        await authorizeTokenizedSource({
          permitRequest: permitRequest(checkout, method),
          sourceId,
        }),
      );
    });
  }

  function submitWallet(method: "applePay" | "googlePay", wallet: SquarePaymentMethod) {
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
      setError(
        walletError instanceof Error
          ? walletError.message
          : "Payment details could not be updated.",
      );
      return;
    }
    walletQuote.current = null;
    void runPayment(async () => {
      const result = await wallet.tokenize();
      const sourceId = checkedToken(result);
      const walletBilling = walletBillingAddress(result.details?.billing);
      const contactEmail =
        result.details?.shipping?.contact?.email ?? result.details?.billing?.email;
      const walletEmail =
        typeof contactEmail === "string" ? contactEmail.trim().toLowerCase() : undefined;
      let checkoutContext: CheckoutPreparationContext = {
        billingAddress: walletBilling,
        buyerEmail: walletEmail,
      };
      if (fulfillment === "ship") {
        const tokenContact = result.details?.shipping?.contact;
        const shippingContext = await resolveWalletShippingContactRef.current(
          walletShippingAddress(tokenContact),
          walletEmail,
        );
        assertWalletTotalUnchanged(
          walletQuote.current ?? exactQuote,
          shippingContext.quote,
        );
        checkoutContext = { ...shippingContext, billingAddress: walletBilling };
      }
      const checkout = await prepare(method, checkoutContext);
      await pay(
        await authorizeTokenizedSource({
          permitRequest: permitRequest(checkout, method),
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
      if (method === "afterpay") {
        const request = walletRequests.current.afterpay;
        if (!request || !exactQuote) {
          throw new Error("Afterpay is still loading. Please try again.");
        }
        afterpayContext.current = { quote: exactQuote, shippingAddress };
        updateSquarePaymentRequest(request, {
          total: walletPaymentTotal(exactQuote),
          requestShippingContact: fulfillment === "ship",
          shippingContact: shippingAddress
            ? contact(shippingAddress.name, buyerEmail, shippingAddress)
            : undefined,
        });
      }
      const checkout = await prepare(method, {
        billingAddress: resolvedBillingAddress,
      });
      const buyer = squareBillingContact({
        cardholderName:
          method === "card"
            ? cardholderName
            : `${resolvedBillingAddress.givenName} ${resolvedBillingAddress.familyName}`,
        buyerEmail,
        billingAddress: resolvedBillingAddress,
      });
      await pay(
        await authorizeAndTokenize({
          permitRequest: permitRequest(checkout, method),
          paymentMethod: payment,
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

  return (
    <>
      <ExpressCheckoutMethods
        applePayReady={Boolean(applePay)}
        googlePayReady={Boolean(googlePay)}
        disabled={isPaying || !quoteReady || (isGuest && !turnstileToken)}
        loading={expressLoading}
        onApplePayClick={() => applePay && submitWallet("applePay", applePay)}
        onGooglePayClick={() => googlePay && submitWallet("googlePay", googlePay)}
      />

      <div className="contents" inert={isPaying}>
        {children}
      </div>

      <CheckoutPaymentPanel
        selectedMethod={selectedMethod}
        afterpayReady={Boolean(afterpay)}
        cashAppPayReady={Boolean(cashAppPay) && !disabled}
        methodMessage={
          selectedMethod === "card"
            ? null
            : !exactQuote
              ? quote?.completeness === "exact"
                ? "Updating total�"
                : "Enter your delivery details to continue."
              : !buyerEmail.trim()
                ? "Enter your email to continue."
                : (methodErrors[selectedMethod] ??
                  ((selectedMethod === "cashAppPay" ? !cashAppPay : !afterpay)
                    ? "Loading payment method�"
                    : isGuest && !turnstileToken
                      ? "Complete the security check to continue."
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
          selectedMethod === "cashAppPay" ? cashAppDisabled : !selectedPayment || disabled
        }
        payLabel={selectedMethod === "afterpay" ? "Continue with Afterpay" : payLabel}
        error={error}
        cardholderNameInput={cardholderNameInput}
        billingFields={billingFields}
        securityChallenge={
          isGuest ? (
            <div
              id="checkout-turnstile-container"
              ref={turnstileContainer}
              className="mt-4"
            />
          ) : null
        }
        onSelectMethod={setSelectedMethod}
        onSameAsShippingChange={setSameAsShipping}
        onCardholderNameChange={setCardholderName}
        onBillingAddressChange={(field, value) =>
          setBillingAddress((current) => ({ ...current, [field]: value }))
        }
        onPay={() =>
          selectedMethod !== "cashAppPay" &&
          selectedPayment &&
          submitPreparedMethod(selectedMethod, selectedPayment)
        }
      />
    </>
  );
}
