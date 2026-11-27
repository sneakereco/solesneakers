"use client";
import {
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { CheckoutPaymentDialog } from "@/components/checkout/CheckoutPaymentDialog";
import { useSession } from "@/contexts/SessionContext";
import { useCart } from "@/Modules/Cart/Source/Client";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/config/constants/contact";
import type { OrderStatusResponse } from "@/types/domain/checkout";
import { observeCheckoutOutcome } from "./outcome-observer";
import type { Outcome } from "./outcome-contract";
import {
  readGuestOrderAccess,
  finishCheckoutAttempt,
  readFinancialPair,
} from "./client-session";
import { useOutcomeAccess } from "./CheckoutOutcomeProvider";

type Entry = "processing" | "success" | "cancel";
type State = {
  state: Outcome["state"];
  order?: OrderStatusResponse;
  signal?: AbortSignal;
};
const waiting: State = { state: "waiting" };
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener("checkout-guest-access", notify);
  window.addEventListener("checkout-financial-pair", notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener("checkout-guest-access", notify);
    window.removeEventListener("checkout-financial-pair", notify);
  };
}
const messages = {
  delayed: [
    "Still confirming your order",
    "Confirmation is taking longer than expected. Check your order status before paying again. If it still hasn’t updated, contact support with the order ID below.",
  ],
  review: [
    "Payment under review",
    "Your order is under review. Check its status before submitting another payment.",
  ],
  refunded: [
    "Order refund recorded",
    "Check your order details or contact support for information about your refund.",
  ],
  denied: [
    "Order details unavailable",
    "Open the secure order link in your email or sign in to the account that placed the order.",
  ],
  canceled: ["Order canceled", "The order status shows that this order was canceled."],
  failed: ["Payment failed", "The order status shows that this payment failed."],
  declined: [
    "Payment declined",
    "The order status shows that this payment was declined.",
  ],
  error: [
    "We could not confirm the order",
    "Check your order status or contact support before trying another payment.",
  ],
};
function Observation({ entry }: { entry: Entry }) {
  const session = useSession();
  const query = useSearchParams();
  const router = useRouter();
  const orderId = query.get("orderId");
  const queryToken = query.get("token") || null;
  const access = useOutcomeAccess();
  const stored = useSyncExternalStore(
    useCallback(
      (notify: () => void) =>
        subscribe(() => {
          access.credential.retain(orderId);
          notify();
        }),
      [access, orderId],
    ),
    useCallback(() => (orderId ? readGuestOrderAccess(orderId) : null), [orderId]),
    () => null,
  );
  const token = queryToken ?? access.credential.read(orderId) ?? stored ?? null;
  const ownClear = useRef<{
    access: typeof access;
    orderId: string | null;
    token: string | null;
    pair: string | null;
  } | null>(null);
  const currentPair = useCallback(() => {
    const raw = readFinancialPair();
    const completed = ownClear.current;
    if (
      completed &&
      raw === "null" &&
      completed.access === access &&
      completed.orderId === orderId &&
      completed.token === token
    )
      return completed.pair;
    return raw;
  }, [access, orderId, token]);
  const subscribePair = useCallback(
    (notify: () => void) =>
      subscribe(() => {
        if (readFinancialPair() !== "null") ownClear.current = null;
        notify();
      }),
    [],
  );
  const pair = useSyncExternalStore(subscribePair, currentPair, () => null);
  const [retry, setRetry] = useState(0);
  const observation = useMemo(
    () => ({ entry, orderId, token, access, retry, pair }),
    [entry, orderId, token, access, retry, pair],
  );
  const [result, setResult] = useState<{
    observation: typeof observation;
    value: State;
  }>();
  const immediate = useRef<{
    observation: typeof observation;
    order: OrderStatusResponse;
  } | null>(null);
  useLayoutEffect(() => {
    // A transient grant is scoped to this order and the stored credential it replaced.
    access.credential.retain(orderId);
  }, [access, orderId, stored]);
  useLayoutEffect(() => {
    if (!orderId || !access.current()) {
      access.handoff.clear();
      return;
    }
    const handoff = entry === "success" ? access.handoff.take(orderId, token) : null;
    if (entry !== "success") access.handoff.clear();
    const lifetime = handoff?.lifetime ?? new AbortController();
    const immediateOrder =
      handoff?.order ??
      (immediate.current?.observation === observation ? immediate.current.order : null);
    if (immediateOrder) {
      immediate.current = { observation, order: immediateOrder };
      setResult({
        observation,
        value: { state: "confirmed", order: immediateOrder, signal: lifetime.signal },
      });
      return () => lifetime.abort();
    }
    let transferred = false;
    const observedPair = observation.pair;
    const stop = observeCheckoutOutcome({
      orderId,
      credential: token,
      identityGeneration: access.current,
      signal: lifetime.signal,
      onState: ({ state, order }) => {
        const activeToken =
          queryToken ??
          access.credential.read(orderId) ??
          readGuestOrderAccess(orderId) ??
          null;
        if (activeToken !== token || currentPair() !== observedPair) {
          setRetry((n) => n + 1);
          return;
        }
        if (
          order &&
          (state === "confirmed" ||
            state === "refunded" ||
            ["failed", "canceled", "declined"].includes(order.status))
        )
          access.closeScope(order.id, token);
        if (entry === "processing" && state === "confirmed" && order) {
          transferred = true;
          access.handoff.put({ token, order, lifetime });
          performance.mark("checkout-confirmed");
          if (performance.getEntriesByName("checkout-payment-start").length)
            performance.measure(
              "checkout-click-to-confirmed",
              "checkout-payment-start",
              "checkout-confirmed",
            );
          const next = new URLSearchParams({ orderId });
          if (queryToken) next.set("token", queryToken);
          router.replace("/checkout/success?" + next.toString());
        } else
          setResult({ observation, value: { state, order, signal: lifetime.signal } });
      },
    });
    return () => {
      stop();
      if (!transferred) lifetime.abort();
    };
  }, [access, currentPair, entry, observation, orderId, queryToken, router, token]);
  const visible = result?.observation === observation ? result.value : waiting;
  const { isReady, consumeConfirmedPurchase } = useCart();
  useLayoutEffect(() => {
    const order = visible.order;
    if (!isReady || visible.state !== "confirmed" || !order?.purchasedLines) return;
    let current = true;
    const isCurrent = () =>
      current &&
      pair !== null &&
      access.current() &&
      currentPair() === pair &&
      (queryToken ??
        access.credential.read(order.id) ??
        readGuestOrderAccess(order.id) ??
        null) === token;
    void consumeConfirmedPurchase(
      order.id,
      order.purchasedLines,
      visible.signal,
      isCurrent,
    )
      .then((consumption) => {
        if (current && currentPair() !== pair) {
          setRetry((n) => n + 1);
          return;
        }
        if (isCurrent() && !visible.signal?.aborted && consumption.status === "matched")
          finishCheckoutAttempt(order.id, consumption.attemptKey, undefined, () => {
            ownClear.current = { access, orderId, token, pair };
          });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [
    access,
    currentPair,
    orderId,
    token,
    pair,
    queryToken,
    isReady,
    visible,
    consumeConfirmedPurchase,
  ]);
  if (session.status === "unavailable" || session.status === "denied")
    return (
      <main className="mx-auto max-w-2xl px-4 py-20 text-center">
        <CheckoutPaymentDialog open={false} />
        <h1>Order access unavailable</h1>
        <p>Open your secure order link or check your session before paying again.</p>
        <button onClick={() => void session.refreshSession()}>Check order status</button>
      </main>
    );
  if (orderId && visible.state === "waiting") return <CheckoutPaymentDialog open />;
  if (orderId && visible.order && visible.state === "confirmed")
    return <Receipt visibleStatus={visible.order} isAuthenticated={access.account} />;
  const [title, message] = !orderId
    ? [
        "Order status unverified",
        "No order was identified. You can return to your cart or continue shopping.",
      ]
    : (messages[
        (visible.state === "error" &&
        ["failed", "canceled", "declined"].includes(visible.order?.status ?? "")
          ? visible.order?.status
          : visible.state) as keyof typeof messages
      ] ?? messages.error);
  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-center text-zinc-950">
      <CheckoutPaymentDialog open={false} />
      <h1 className="mb-4 text-3xl font-bold">{title}</h1>
      <p role="status" className="mb-6">
        {message}
      </p>
      {orderId && (
        <>
          <p className="mb-4 text-xs text-zinc-600">Order ID: {orderId}</p>
          <button
            className="mb-4 bg-zinc-950 px-4 py-3 text-white"
            onClick={() => setRetry((n) => n + 1)}
          >
            Check order status
          </button>
        </>
      )}
      <div className="space-x-4">
        <button onClick={() => router.push("/cart")}>Return to Cart</button>
        <button onClick={() => router.push("/store")}>Continue Shopping</button>
      </div>
    </main>
  );
}
export function CheckoutOutcome({ entry }: { entry: Entry }) {
  return (
    <Suspense fallback={<CheckoutPaymentDialog open />}>
      <Observation entry={entry} />
    </Suspense>
  );
}

function Receipt({
  visibleStatus,
  isAuthenticated,
}: {
  visibleStatus: OrderStatusResponse;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const isPickup = visibleStatus.fulfillment === "pickup";
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <CheckoutPaymentDialog open={false} />
      <CheckCircle className="mx-auto mb-6 h-16 w-16 text-zinc-950" />
      <h1 className="mb-4 text-3xl font-bold text-zinc-950">Order Confirmed!</h1>
      <p className="mb-8 text-zinc-600">
        Thank you for your purchase. Your order has been successfully processed.
      </p>

      <div className="mb-6 border border-zinc-300 bg-white p-6 text-left">
        <h2 className="mb-4 text-xl font-semibold text-zinc-950">Order Details</h2>
        <div className="space-y-2 text-zinc-600">
          <div className="flex justify-between">
            <span>Order ID:</span>
            <span className="font-mono text-sm text-zinc-950">{visibleStatus.id}</span>
          </div>
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span className="text-zinc-950">${visibleStatus.subtotal.toFixed(2)}</span>
          </div>
          {visibleStatus.fulfillment !== null && (
            <div className="flex justify-between">
              <span>Shipping:</span>
              <span className="text-zinc-950">
                {visibleStatus.fulfillment === "pickup"
                  ? "Free (Pickup)"
                  : `$${visibleStatus.shipping.toFixed(2)}`}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Tax:</span>
            <span className="text-zinc-950">${visibleStatus.tax.toFixed(2)}</span>
          </div>
          <div className="mt-2 border-t border-zinc-300 pt-2">
            <div className="flex justify-between text-xl font-bold">
              <span className="text-zinc-950">Total:</span>
              <span className="text-zinc-950">${visibleStatus.total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {isPickup && (
        <div className="mb-6 border border-zinc-300 bg-white p-6 text-left">
          <h2 className="mb-2 text-lg font-semibold text-zinc-950">Local pickup</h2>
          <p className="mb-2 text-sm text-zinc-600">
            Check your email for pickup instructions and scheduling.
          </p>
          <p className="mb-2 text-sm text-zinc-600">
            You can also DM us on{" "}
            <a
              href={INSTAGRAM_URL}
              className="text-zinc-950 underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
            >
              Instagram {INSTAGRAM_HANDLE}
            </a>
            .
          </p>
        </div>
      )}

      <div className="space-y-3">
        {isAuthenticated && (
          <button
            onClick={() => router.push("/account")}
            className="w-full bg-zinc-950 py-3 font-bold text-white transition hover:bg-black"
          >
            Go to Account
          </button>
        )}
        <button
          onClick={() => router.push("/store")}
          className="w-full bg-zinc-800 py-3 font-semibold text-white transition hover:bg-zinc-700"
        >
          Continue Shopping
        </button>
      </div>
    </div>
  );
}
