"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { clientEnv } from "@/config/client-env";
import type { CheckoutPageData } from "@/lib/checkout/checkout-page-data";
import type {
  ExactCheckoutQuote,
  PaymentPermitRequest,
} from "@/lib/checkout/checkout-request";
import {
  authorizeAndTokenize,
  authorizeTokenizedSource,
  loadSquareWebPayments,
  type SquareCashAppPayMethod,
  type SquarePaymentMethod,
  type SquareTokenResult,
} from "@/lib/square/web-payments";

type PaymentMethod = PaymentPermitRequest["method"];

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
  exactQuote,
  fulfillment,
  buyerEmail,
  shippingAddress,
  isGuest,
  prepare,
  clearCart,
  children,
}: {
  paymentConfig: CheckoutPageData["paymentConfig"];
  exactQuote: ExactCheckoutQuote | null;
  fulfillment: "ship" | "pickup";
  buyerEmail: string;
  shippingAddress: CheckoutPaymentAddress | null;
  isGuest: boolean;
  prepare(method: PaymentMethod): Promise<PreparedCheckout>;
  clearCart(): void;
  children?: ReactNode;
}) {
  const [payments, setPayments] = useState<Awaited<
    ReturnType<typeof loadSquareWebPayments>
  > | null>(null);
  const [card, setCard] = useState<SquarePaymentMethod | null>(null);
  const [applePay, setApplePay] = useState<SquarePaymentMethod | null>(null);
  const [googlePay, setGooglePay] = useState<SquarePaymentMethod | null>(null);
  const [cashAppPay, setCashAppPay] = useState<SquareCashAppPayMethod | null>(null);
  const [afterpay, setAfterpay] = useState<SquarePaymentMethod | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileWidget, setTurnstileWidget] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const turnstileTokenRef = useRef<string | null>(null);

  function updateTurnstileToken(token: string | null) {
    turnstileTokenRef.current = token;
    setTurnstileToken(token);
  }

  useEffect(() => {
    let active = true;
    let nextCard: SquarePaymentMethod | null = null;
    void (async () => {
      try {
        const nextPayments = await loadSquareWebPayments(paymentConfig);
        nextCard = await nextPayments.card();
        if (!nextCard.attach) {
          throw new Error("square_card_attach_unavailable");
        }
        await nextCard.attach("#square-card-container");
        if (active) {
          setPayments(nextPayments);
          setCard(nextCard);
        }
      } catch {
        if (active) {
          setError("Secure payment fields could not be loaded. Please retry.");
        }
      }
    })();
    return () => {
      active = false;
      void nextCard?.destroy?.();
    };
  }, [paymentConfig.applicationId, paymentConfig.environment, paymentConfig.locationId]);

  useEffect(() => {
    if (!payments || !exactQuote) {
      return;
    }
    let active = true;
    const created: Array<SquarePaymentMethod | SquareCashAppPayMethod> = [];
    const total = money(exactQuote.totals.totalCents);
    const request = payments.paymentRequest({
      countryCode: "US",
      currencyCode: "USD",
      total: { amount: total, label: "Total", pending: false },
      shippingContact: shippingAddress
        ? contact(shippingAddress.name, buyerEmail, shippingAddress)
        : undefined,
      requestShippingContact: fulfillment === "ship",
    });

    if (shippingAddress) {
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

    void (async () => {
      try {
        const method = await payments.applePay(request);
        created.push(method);
        if (active) {
          setApplePay(method);
        }
      } catch {}
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
      } catch {}
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
      } catch {}
      try {
        const method = await payments.afterpayClearpay(request);
        created.push(method);
        if (!method.attach) {
          throw new Error("square_afterpay_attach_unavailable");
        }
        await method.attach("#square-afterpay-container");
        if (active) {
          setAfterpay(method);
        }
      } catch {}
    })();

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
    // Payment methods must be rebuilt only when their authoritative amount changes.
  }, [exactQuote?.quoteFingerprint, payments]);

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
          "error-callback": () => updateTurnstileToken(null),
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

  function assertPayable(): void {
    if (!exactQuote) {
      throw new Error("Complete the address to calculate your total.");
    }
    if (isGuest && !turnstileTokenRef.current) {
      throw new Error("Complete the security check before paying.");
    }
  }

  async function runPayment(action: () => Promise<void>) {
    if (isPaying) {
      return;
    }
    setIsPaying(true);
    setError(null);
    try {
      assertPayable();
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
      if (turnstileWidget && window.turnstile) {
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
    if (isPaying || !exactQuote || (isGuest && !turnstileToken)) {
      return;
    }
    const tokenPromise = wallet.tokenize();
    void runPayment(async () => {
      const sourceId = checkedToken(await tokenPromise);
      const checkout = await prepare(method);
      await pay(
        await authorizeTokenizedSource({
          permitRequest: permitRequest(checkout, method),
          sourceId,
        }),
      );
    });
  }

  function submitPreparedMethod(
    method: "card" | "afterpay",
    payment: SquarePaymentMethod,
  ) {
    void runPayment(async () => {
      const checkout = await prepare(method);
      const buyer = contact(
        shippingAddress?.name ?? buyerEmail,
        buyerEmail,
        shippingAddress,
      );
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
  const payLabel = exactQuote
    ? `Pay $${money(exactQuote.totals.totalCents)} now`
    : "Pay now";

  return (
    <>
      <section className="order-1" aria-labelledby="express-checkout-heading">
        <h2 id="express-checkout-heading" className="text-center text-sm text-zinc-600">
          Express checkout
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            id="square-apple-pay-container"
            type="button"
            aria-label="Pay with Apple Pay"
            className={applePay ? "h-12 rounded bg-black" : "hidden"}
            onClick={() => applePay && submitWallet("applePay", applePay)}
          />
          <div
            id="square-google-pay-container"
            className={googlePay ? "min-h-12" : "hidden"}
            onClick={() => googlePay && submitWallet("googlePay", googlePay)}
          />
          <div
            id="square-cash-app-pay-container"
            className={cashAppPay ? "min-h-12" : "hidden"}
          />
        </div>
        {!exactQuote && (
          <p className="mt-3 text-center text-xs text-zinc-500">
            Calculated after address
          </p>
        )}
        <div className="my-6 flex items-center gap-4 text-xs uppercase text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" /> or
          <span className="h-px flex-1 bg-zinc-200" />
        </div>
      </section>

      {children}

      <section className="order-4 mt-8" aria-labelledby="payment-heading">
        <h2 id="payment-heading" className="text-2xl font-semibold">
          Payment
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          All transactions are secure and encrypted.
        </p>
        <div className="mt-4 rounded-xl border border-zinc-300 bg-zinc-50 p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4" /> Credit card
          </p>
          <div id="square-card-container" className="min-h-24 rounded bg-white" />
        </div>
        {isGuest && <div ref={turnstileContainer} className="mt-4" />}
        <button
          type="button"
          disabled={!card || disabled}
          onClick={() => card && submitPreparedMethod("card", card)}
          className="mt-5 flex w-full items-center justify-center rounded bg-zinc-950 px-6 py-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isPaying ? <Loader2 className="h-5 w-5 animate-spin" /> : payLabel}
        </button>
        <div
          id="square-afterpay-container"
          onClick={() => afterpay && submitPreparedMethod("afterpay", afterpay)}
          className={afterpay && !disabled ? "mt-3" : "hidden"}
        />
        {error && (
          <p role="alert" className="mt-4 text-sm text-amber-800">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
