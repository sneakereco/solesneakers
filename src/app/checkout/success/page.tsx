"use client";

import { FeedbackLink } from "@/components/ui/FeedbackLink";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { CheckoutPaymentDialog } from "@/components/checkout/CheckoutPaymentDialog";
import { useCart } from "@/components/cart/CartProvider";
import { useSession } from "@/contexts/SessionContext";
import { useHydrated } from "@/components/ui/useHydrated";
import { startCheckoutOrderPolling } from "@/lib/checkout/checkout-order-polling";
import {
  readGuestOrderAccess,
  storeGuestOrderAccess,
} from "@/lib/checkout/client-session";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/config/constants/contact";
import type { OrderStatusResponse } from "@/types/domain/checkout";

function SuccessContent() {
  const params = useSearchParams(),
    router = useRouter();
  const orderId = params.get("orderId"),
    hydrated = useHydrated();
  const { user, isLoading, isSessionUnavailable, refreshSession } = useSession();
  let token = params.get("token");
  if (hydrated && orderId && !token) {
    try {
      token = readGuestOrderAccess(orderId);
    } catch {
      /* Access can still be verified by the signed-in session. */
    }
  }
  useEffect(() => {
    if (!orderId) router.push("/cart");
  }, [orderId, router]);
  if (!orderId) return null;
  if (!hydrated || isLoading) return <CheckoutPaymentDialog open />;
  if (!token && isSessionUnavailable)
    return (
      <Notice
        message="We could not verify your account."
        retry={() => void refreshSession()}
      />
    );
  if (!token && !user)
    return (
      <Notice message="Open the secure order link from your email or sign in to view this order." />
    );
  return (
    <Receipt
      key={JSON.stringify([orderId, token, user?.id, isSessionUnavailable])}
      orderId={orderId}
      token={token}
      isAuthenticated={Boolean(user)}
    />
  );
}

function Notice({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-center">
      <CheckoutPaymentDialog open={false} />
      <h1 className="mb-4 text-3xl font-bold">Unable to verify this order</h1>
      <p role="status">{message}</p>
      {retry && (
        <button type="button" className="mt-4 underline" onClick={retry}>
          Check again
        </button>
      )}
      <FeedbackLink href="/contact" className="ml-4 underline">
        Contact support
      </FeedbackLink>
      <FeedbackLink
        href="/store"
        className="mt-6 block w-full bg-zinc-950 py-3 text-center text-white"
      >
        Continue shopping
      </FeedbackLink>
    </main>
  );
}

function ReceiptCartUpdate({ order }: { order: OrderStatusResponse }) {
  const { consumeConfirmedOrder } = useCart();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"quiet" | "failed" | "retrying">("quiet");
  useEffect(() => {
    let current = true;
    let unavailable = false;
    void consumeConfirmedOrder(order, () => {
      unavailable = true;
    }).then(() => {
      if (current) setStatus(unavailable ? "failed" : "quiet");
    });
    return () => {
      current = false;
    };
  }, [order, consumeConfirmedOrder, attempt]);
  if (status === "quiet") return null;
  return (
    <div className="mb-6 border border-zinc-300 p-4 text-sm">
      <p role="status">
        {status === "retrying"
          ? "Updating your cart…"
          : "We could not check or update your cart after this purchase."}
      </p>
      <button
        type="button"
        className="mt-2 underline"
        disabled={status === "retrying"}
        onClick={() => {
          setStatus("retrying");
          setAttempt((value) => value + 1);
        }}
      >
        Retry cart update
      </button>
    </div>
  );
}

function Receipt({
  orderId,
  token,
  isAuthenticated,
}: {
  orderId: string;
  token: string | null;
  isAuthenticated: boolean;
}) {
  const [retry, setRetry] = useState(0);
  const [visibleStatus, setStatus] = useState<OrderStatusResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    return startCheckoutOrderPolling(
      orderId,
      token,
      (state, order) => {
        if (state === "paid" && order) {
          if (token) {
            try {
              storeGuestOrderAccess(orderId, token);
            } catch {
              /* Already verified by this read. */
            }
          }
          setStatus(order);
          return;
        }
        setMessage(
          state === "delayed"
            ? "We are still waiting for confirmation. Check again before making another payment."
            : state === "review"
              ? "This payment is under review. Check again before submitting another payment."
              : state === "unauthorized"
                ? "Open the secure order link from your email or sign in to view this order."
                : "We could not verify a confirmed payment. Check again or contact support before paying again.",
        );
      },
      { reconcile: false },
    );
  }, [orderId, token, retry]);

  if (message)
    return (
      <Notice
        message={message}
        retry={() => {
          setMessage(null);
          setRetry((n) => n + 1);
        }}
      />
    );
  if (!visibleStatus) return <CheckoutPaymentDialog open />;
  const isPickup = visibleStatus.fulfillment === "pickup";
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <CheckoutPaymentDialog open={false} />
      <CheckCircle className="mx-auto mb-6 h-16 w-16 text-zinc-950" />
      <h1 className="mb-4 text-3xl font-bold text-zinc-950">Order Confirmed!</h1>
      <p className="mb-8 text-zinc-600">
        Thank you for your purchase. Your order has been successfully processed.
      </p>

      <ReceiptCartUpdate order={visibleStatus} />
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
          <div className="flex justify-between">
            <span>Shipping:</span>
            <span className="text-zinc-950">
              {visibleStatus.fulfillment === "pickup"
                ? "Free (Pickup)"
                : `$${visibleStatus.shipping.toFixed(2)}`}
            </span>
          </div>
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
          <FeedbackLink
            href="/account"
            className="block w-full bg-zinc-950 py-3 text-center font-bold text-white transition hover:bg-black"
          >
            Go to Account
          </FeedbackLink>
        )}
        <FeedbackLink
          href="/store"
          className="block w-full bg-zinc-800 py-3 text-center font-semibold text-white transition hover:bg-zinc-700"
        >
          Continue Shopping
        </FeedbackLink>
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<CheckoutPaymentDialog open />}>
      <SuccessContent />
    </Suspense>
  );
}
