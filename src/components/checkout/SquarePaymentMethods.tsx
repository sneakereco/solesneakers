"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { clientEnv } from "@/config/client-env";
import {
  authorizeAndTokenize,
  loadSquareWebPayments,
  type SquareEnvironment,
  type SquarePaymentMethod,
} from "@/lib/square/web-payments";

type Address = {
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: "US";
};

type PreparedCheckout = {
  orderId: string;
  guestAccessToken?: string;
  totals: {
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
  };
  paymentConfig: {
    applicationId: string;
    locationId: string;
    environment: SquareEnvironment;
  };
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

function contact(name: string, email: string, address: Address | null) {
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
  checkout,
  deviceSessionId,
  buyerEmail,
  shippingAddress,
  isGuest,
  clearCart,
}: {
  checkout: PreparedCheckout;
  deviceSessionId: string;
  buyerEmail: string;
  shippingAddress: Address | null;
  isGuest: boolean;
  clearCart(): void;
}) {
  const [card, setCard] = useState<SquarePaymentMethod | null>(null);
  const [afterpay, setAfterpay] = useState<SquarePaymentMethod | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileWidget, setTurnstileWidget] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstileContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let nextCard: SquarePaymentMethod | null = null;
    let nextAfterpay: SquarePaymentMethod | null = null;
    void (async () => {
      try {
        const payments = await loadSquareWebPayments(checkout.paymentConfig);
        nextCard = await payments.card();
        await nextCard.attach("#square-card-container");
        if (active) {
          setCard(nextCard);
        }

        try {
          const total = money(checkout.totals.totalCents);
          const request = payments.paymentRequest({
            countryCode: "US",
            currencyCode: "USD",
            total: { amount: total, label: "Total" },
            shippingContact: contact(
              shippingAddress?.name ?? buyerEmail,
              buyerEmail,
              shippingAddress,
            ),
            requestShippingContact: Boolean(shippingAddress),
          });
          if (shippingAddress) {
            request.addEventListener("afterpay_shippingaddresschanged", (value) => {
              const next = value as Partial<Address> & { countryCode?: string };
              if (
                next.countryCode !== "US" ||
                next.state !== shippingAddress.state ||
                next.postalCode !== shippingAddress.postalCode
              ) {
                return {
                  error: "Use the shipping address confirmed on the checkout page.",
                };
              }
              return {
                shippingOptions: [
                  {
                    id: "CONFIRMED",
                    label: "Confirmed shipping",
                    amount: money(checkout.totals.shippingCents),
                    taxLineItems: [
                      { label: "Tax", amount: money(checkout.totals.taxCents) },
                    ],
                    total: { label: "Total", amount: total },
                  },
                ],
              };
            });
          }
          nextAfterpay = await payments.afterpayClearpay(request);
          await nextAfterpay.attach("#square-afterpay-container");
          if (active) {
            setAfterpay(nextAfterpay);
          }
        } catch {
          // Afterpay eligibility and browser support must not disable card checkout.
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
      void nextAfterpay?.destroy?.();
    };
  }, [buyerEmail, checkout, shippingAddress]);

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
          callback: (token: string) => setTurnstileToken(token),
          "expired-callback": () => setTurnstileToken(null),
          "error-callback": () => setTurnstileToken(null),
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

  const submit = async (method: "card" | "afterpay") => {
    const paymentMethod = method === "card" ? card : afterpay;
    if (!paymentMethod || isPaying) {
      return;
    }
    if (isGuest && !turnstileToken) {
      setError("Complete the security check before paying.");
      return;
    }
    setIsPaying(true);
    setError(null);
    try {
      const buyer = contact(
        shippingAddress?.name ?? buyerEmail,
        buyerEmail,
        shippingAddress,
      );
      const authorization = await authorizeAndTokenize({
        permitRequest: {
          orderId: checkout.orderId,
          guestAccessToken: checkout.guestAccessToken,
          deviceSessionId,
          method,
          turnstileToken: isGuest ? turnstileToken : undefined,
        },
        paymentMethod,
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
      });
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
    } catch (paymentError) {
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : "Payment could not be completed",
      );
      setIsPaying(false);
    } finally {
      setTurnstileToken(null);
      if (turnstileWidget && window.turnstile) {
        window.turnstile.reset(turnstileWidget);
      }
    }
  };

  return (
    <section className="mt-6 border-t border-zinc-200 pt-6" aria-label="Payment methods">
      <p className="flex items-center gap-2 text-xs text-zinc-600">
        <ShieldCheck className="h-4 w-4" /> Card details stay inside Square’s secure
        fields.
      </p>
      <div id="square-card-container" className="mt-4 min-h-24" />
      <button
        type="button"
        disabled={!card || isPaying || (isGuest && !turnstileToken)}
        onClick={() => void submit("card")}
        className="flex w-full items-center justify-center bg-zinc-950 px-6 py-4 text-sm font-medium uppercase text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {isPaying ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          `Pay $${money(checkout.totals.totalCents)} by card`
        )}
      </button>
      <div
        id="square-afterpay-container"
        onClick={() => void submit("afterpay")}
        className={afterpay && !isPaying ? "mt-3" : "hidden"}
      />
      {isGuest && <div ref={turnstileContainer} className="mt-4" />}
      {error && (
        <p role="alert" className="mt-4 text-sm text-amber-800">
          {error}
        </p>
      )}
    </section>
  );
}
