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
  const exactQuote = quote?.completeness === "exact" ? quote : null;
  const [payments, setPayments] = useState<Awaited<
    ReturnType<typeof loadSquareWebPayments>
  > | null>(null);
  const [card, setCard] = useState<SquarePaymentMethod | null>(null);
  const [applePay, setApplePay] = useState<SquarePaymentMethod | null>(null);
  const [googlePay, setGooglePay] = useState<SquarePaymentMethod | null>(null);
  const [cashAppPay, setCashAppPay] = useState<SquareCashAppPayMethod | null>(null);
  const [afterpay, setAfterpay] = useState<SquarePaymentMethod | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<"card" | "afterpay">("card");
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
    if (!payments || !quote) {
      return;
    }
    let active = true;
    const created: Array<SquarePaymentMethod | SquareCashAppPayMethod> = [];
    setExpressLoading(true);
    walletQuote.current = null;
    const paymentTotal = walletPaymentTotal(quote);
    const request = payments.paymentRequest({
      countryCode: "US",
      currencyCode: "USD",
      total: paymentTotal,
      shippingContact: shippingAddress
        ? contact(shippingAddress.name, buyerEmail, shippingAddress)
        : undefined,
      requestShippingContact: fulfillment === "ship",
      requestBillingContact: true,
      billingContact: resolvedBillingAddress
        ? squareBillingContact({
            cardholderName: `${resolvedBillingAddress.givenName} ${resolvedBillingAddress.familyName}`,
            buyerEmail,
            billingAddress: resolvedBillingAddress,
          })
        : undefined,
    });

    if (fulfillment === "ship") {
      bindWalletShippingContact(
        request,
        (value) => quoteWalletShippingDestinationRef.current(value),
        (context) => {
          walletQuote.current = context.quote;
        },
      );
    }

    if (shippingAddress && exactQuote) {
      const total = money(exactQuote.totals.totalCents);
      request.addEventListener("afterpay_shippingaddresschanged", (value) => {
        const next = value as Partial<CheckoutPaymentAddress> & { countryCode?: string };
        if (
          next.countryCode !== "US" ||
          next.state !== shippingAddress.state ||
          next.postalCode !== shippingAddress.postalCode
        ) {
          return { error: "Use the shipping address confirmed on the checkout page." };
        }
        return {
          shippingOptions: [
            {
              id: "CONFIRMED",
              label: "Confirmed shipping",
              amount: money(exactQuote.totals.shippingCents),
              taxLineItems: [{ label: "Tax", amount: money(exactQuote.totals.taxCents) }],
              total: { label: "Total", amount: total },
            },
          ],
        };
      });
    }

    const expressInitializers: Array<() => Promise<void>> = [
      async () => {
        try {
          const method = await payments.applePay(request);
          created.push(method);
          if (active) {
            setApplePay(method);
          }
        } catch (methodError) {
          reportUnavailable("applePay", "create", methodError);
        }
      },
      async () => {
        try {
          const method = await payments.googlePay(request);
          created.push(method);
          if (!method.attach) {
            throw new Error("square_google_pay_attach_unavailable");
          }
          await method.attach("#square-google-pay-container");
          if (active) {
            setGooglePay(method);
          }
        } catch (methodError) {
          reportUnavailable("googlePay", "create", methodError);
        }
      },
    ];
    if (exactQuote) {
      expressInitializers.push(async () => {
        try {
          const method = await payments.cashAppPay(request, {
            redirectURL: window.location.href,
            referenceId: exactQuote.quoteFingerprint.slice(0, 40),
            shouldTokenize: () => !isGuest || Boolean(turnstileTokenRef.current),
          });
          created.push(method);
          method.addEventListener("ontokenization", (event) => {
            const detail = (event as { detail?: { tokenResult?: SquareTokenResult } })
              .detail;
            if (detail?.tokenResult) {
              void submitTokenizedWallet("cashAppPay", detail.tokenResult);
            }
          });
          await method.attach("#square-cash-app-pay-container");
          if (active) {
            setCashAppPay(method);
          }
        } catch (methodError) {
          reportUnavailable("cashAppPay", "create", methodError);
        }
      });
      void (async () => {
        try {
          const method = await payments.afterpayClearpay(request);
          created.push(method);
          if (!method.attach) {
            throw new Error("square_afterpay_attach_unavailable");
          }
          await method.attach("#square-afterpay-container", { useCustomButton: true });
          if (active) {
            setAfterpay(method);
          }
        } catch (methodError) {
          reportUnavailable("afterpay", "create", methodError);
        }
      })();
    }
    void initializePaymentMethodsConcurrently(expressInitializers).then(() => {
      if (active) {
        setExpressLoading(false);
      }
    });

    return () => {
      active = false;
      setApplePay(null);
      setGooglePay(null);
      setCashAppPay(null);
      setAfterpay(null);
      for (const method of created) {
        void method.destroy?.();
      }
    };
    // Payment methods must be rebuilt when their authoritative amount or buyer email changes.
  }, [
    buyerEmail,
    exactQuote?.quoteFingerprint,
    fulfillment,
    payments,
    quote,
    resolvedBillingAddress,
    shippingAddress,
  ]);

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
    if (isPaying) {
      return;
    }
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
      updateTurnstileToken(null);
      if (turnstileWidget && window.turnstile && !turnstileTerminalError.current) {
        window.turnstile.reset(turnstileWidget);
      }
    }
  }

  async function submitTokenizedWallet(method: PaymentMethod, result: SquareTokenResult) {
    await runPayment(async () => {
      const sourceId = checkedToken(result);
      const checkout = await prepare(method);
      await pay(
        await authorizeTokenizedSource({
          permitRequest: permitRequest(checkout, method),
          sourceId,
        }),
      );
    });
  }

  function submitWallet(method: "applePay" | "googlePay", wallet: SquarePaymentMethod) {
    if (isPaying || (isGuest && !turnstileToken)) {
      return;
    }
    const tokenPromise = wallet.tokenize();
    void runPayment(async () => {
      const result = await tokenPromise;
      const sourceId = checkedToken(result);
      const walletBilling = walletBillingAddress(result.details?.billing);
      let checkoutContext: CheckoutPreparationContext | undefined = walletBilling
        ? { billingAddress: walletBilling }
        : undefined;
      if (fulfillment === "ship") {
        const tokenContact = result.details?.shipping?.contact;
        const walletEmail =
          typeof tokenContact?.email === "string"
            ? tokenContact.email.trim().toLowerCase()
            : undefined;
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
      const checkout = await prepare(method, checkoutContext ?? undefined);
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
  const payLabel = exactQuote
    ? `Pay $${money(exactQuote.totals.totalCents)} now`
    : "Pay now";

  return (
    <>
      <ExpressCheckoutMethods
        applePayReady={Boolean(applePay)}
        googlePayReady={Boolean(googlePay)}
        cashAppPayReady={Boolean(cashAppPay)}
        loading={expressLoading}
        quoteIsExact={Boolean(exactQuote)}
        onApplePayClick={() => applePay && submitWallet("applePay", applePay)}
        onGooglePayClick={() => googlePay && submitWallet("googlePay", googlePay)}
      />

      {children}

      <CheckoutPaymentPanel
        selectedMethod={selectedMethod}
        afterpayReady={Boolean(afterpay)}
        fulfillment={fulfillment}
        sameAsShipping={sameAsShipping}
        cardholderName={cardholderName}
        billingAddress={billingAddress}
        isPaying={isPaying}
        payDisabled={!selectedPayment || disabled}
        payLabel={payLabel}
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
          selectedPayment && submitPreparedMethod(selectedMethod, selectedPayment)
        }
      />
    </>
  );
}
