// app/checkout/success/page.tsx
"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, Loader2, Mail } from "lucide-react";

import { clearIdempotencyKeyFromStorage } from "@/lib/checkout/idempotency";
import type { OrderStatusResponse } from "@/types/domain/checkout";
import { useCart } from "@/components/cart/CartProvider";
import { useHydrated } from "@/components/ui/useHydrated";
import { clearGuestShippingAddress } from "@/lib/checkout/guest-shipping-address";
import {
  readGuestOrderAccess,
  storeGuestOrderAccess,
} from "@/lib/checkout/client-session";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/config/constants/contact";

function SuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { clearCart } = useCart();
  const orderId = searchParams.get("orderId");
  const tokenParam = searchParams.get("token");
  const fulfillmentParam = searchParams.get("fulfillment");
  const isPickupParam = fulfillmentParam === "pickup";

  const hydrated = useHydrated();
  const accessToken =
    tokenParam ?? (hydrated && orderId ? readGuestOrderAccess(orderId) : null);
  const [status, setStatus] = useState<OrderStatusResponse | null>(null);
  const [accessResult, setAccessResult] = useState<{
    orderId: string | null;
    token: string | null;
    allowed: boolean;
  } | null>(null);
  const sessionAccess =
    accessResult?.orderId === orderId && accessResult.token === accessToken
      ? accessResult.allowed
      : null;
  const canFetchStatus =
    sessionAccess === false ? false : accessToken ? true : sessionAccess;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasClearedRef = useRef(false);

  useEffect(() => {
    if (!orderId) {
      router.push("/cart");
      return;
    }

    clearIdempotencyKeyFromStorage();
    clearGuestShippingAddress();

    if (!hasClearedRef.current) {
      hasClearedRef.current = true;
      clearCart();
    }
  }, [orderId, router, clearCart]);

  useEffect(() => {
    if (!orderId) {
      return;
    }

    if (accessToken) {
      storeGuestOrderAccess(orderId, accessToken);
    }
  }, [orderId, accessToken]);

  useEffect(() => {
    if (!hydrated || accessToken) {
      return;
    }

    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await response.json().catch(() => null);
        const hasUser = Boolean(data?.user);
        setIsAuthenticated(hasUser);
        setAccessResult({ orderId, token: accessToken, allowed: hasUser });
      } catch {
        setAccessResult({ orderId, token: accessToken, allowed: false });
      }
    };

    void loadSession();
  }, [accessToken, hydrated, orderId]);

  useEffect(() => {
    if (!orderId || !canFetchStatus) {
      return;
    }

    const pollOrderStatus = async () => {
      try {
        const tokenQuery = accessToken ? `?token=${encodeURIComponent(accessToken)}` : "";
        const response = await fetch(`/api/orders/${orderId}${tokenQuery}`, {
          cache: "no-store",
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (data?.error === "Unauthorized") {
            setAccessResult({ orderId, token: accessToken, allowed: false });
            return;
          }
          throw new Error(data?.error || "Failed to fetch order status");
        }

        setStatus(data);

        if (data?.status === "paid") {
          clearInterval(pollInterval);
          clearTimeout(timeoutId);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch order status";
        setError(message);
        clearInterval(pollInterval);
        clearTimeout(timeoutId);
      }
    };

    const pollInterval = setInterval(() => {
      void pollOrderStatus();
    }, 2000);
    const timeoutId = setTimeout(() => {
      clearInterval(pollInterval);
    }, 60000);
    void pollOrderStatus();

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  }, [accessToken, canFetchStatus, orderId]);

  if (!orderId) {
    return null;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="border border-zinc-300 bg-white p-6 text-zinc-950">
          <p className="mb-2 text-lg font-semibold">Error</p>
          <p>{error}</p>
          <button
            onClick={() => router.push("/cart")}
            className="mt-4 bg-zinc-950 px-6 py-2 text-white transition hover:bg-black"
          >
            Return to Cart
          </button>
        </div>
      </div>
    );
  }

  if (canFetchStatus === false) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <Mail className="mx-auto mb-6 h-16 w-16 text-zinc-950" />
        <h1 className="mb-4 text-3xl font-bold text-zinc-950">Order Confirmed!</h1>
        <p className="mb-6 text-zinc-600">
          Your payment was accepted. We could not load the full order details on this
          device, but we will email your confirmation and secure order link shortly.
        </p>
        {isPickupParam && (
          <div className="mb-6 border border-zinc-300 bg-white p-6 text-left">
            <h2 className="mb-2 text-lg font-semibold text-zinc-950">Local pickup</h2>
            <p className="mb-2 text-sm text-zinc-600">
              Check your email for pickup instructions and scheduling.
            </p>
            <p className="text-sm text-zinc-600">
              You can also DM us on Instagram{" "}
              <a
                href={INSTAGRAM_URL}
                className="text-zinc-950 underline underline-offset-4"
                target="_blank"
                rel="noreferrer"
              >
                {INSTAGRAM_HANDLE}
              </a>{" "}
              to schedule pickup.
            </p>
          </div>
        )}
        <p className="mb-6 text-xs text-zinc-500">Order ID: {orderId}</p>
        <button
          onClick={() => router.push("/store")}
          className="w-full bg-zinc-950 py-3 font-bold text-white transition hover:bg-black"
        >
          Continue Shopping
        </button>
      </div>
    );
  }

  if (!status || status.status !== "paid") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <Loader2 className="mx-auto mb-6 h-16 w-16 animate-spin text-zinc-950" />
        <h1 className="mb-4 text-3xl font-bold text-zinc-950">
          Processing your payment...
        </h1>
        <p className="mb-8 text-zinc-600">
          Please wait while we confirm your order. This should only take a moment.
        </p>
        {status && (
          <div className="border border-zinc-300 bg-white p-6 text-left">
            <div className="mb-2 flex justify-between text-zinc-600">
              <span>Order ID:</span>
              <span className="font-mono text-sm text-zinc-950">{status.id}</span>
            </div>
            <div className="flex justify-between text-zinc-600">
              <span>Status:</span>
              <span className="capitalize text-amber-600">{status.status}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  const isPickup = status.fulfillment === "pickup" || isPickupParam;
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
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
            <span className="font-mono text-sm text-zinc-950">{status.id}</span>
          </div>
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span className="text-zinc-950">${status.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Shipping:</span>
            <span className="text-zinc-950">
              {status.fulfillment === "pickup"
                ? "Free (Pickup)"
                : `$${status.shipping.toFixed(2)}`}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Tax:</span>
            <span className="text-zinc-950">${status.tax.toFixed(2)}</span>
          </div>
          <div className="mt-2 border-t border-zinc-300 pt-2">
            <div className="flex justify-between text-xl font-bold">
              <span className="text-zinc-950">Total:</span>
              <span className="text-zinc-950">${status.total.toFixed(2)}</span>
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

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <Loader2 className="mx-auto h-16 w-16 animate-spin text-zinc-950" />
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
