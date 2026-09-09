"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";

import { startCheckoutOrderPolling } from "@/lib/checkout/checkout-order-polling";
import { readGuestOrderAccess } from "@/lib/checkout/client-session";

type ViewState = "waiting" | "delayed" | "review" | "error";

function ProcessingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const [view, setView] = useState<ViewState>("waiting");
  const [message, setMessage] = useState("Confirming your payment securely...");

  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!orderId) {
      router.replace("/cart");
      return;
    }

    return startCheckoutOrderPolling(orderId, readGuestOrderAccess(orderId), (state) => {
      if (state === "paid") {
        router.replace(`/checkout/success?orderId=${encodeURIComponent(orderId)}`);
        return;
      }
      setView(state === "unauthorized" ? "error" : state);
      setMessage(
        state === "delayed"
          ? "We could not confirm your order yet. Do not pay again. Check the status below or contact support with your order ID."
          : state === "review"
            ? "Your payment was received and is being reviewed. Do not submit another payment."
            : state === "unauthorized"
              ? "This browser cannot open the order details. Check your email for your secure order link."
              : "This checkout could not be completed. Check your email or contact support before trying again.",
      );
    });
  }, [orderId, router, retry]);

  if (!orderId) {
    return null;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--storefront-surface)] px-5 text-zinc-950">
      <div className="w-full max-w-md text-center">
        {view === "waiting" && (
          <Loader2 className="mx-auto mb-6 h-16 w-16 animate-spin text-zinc-950" />
        )}
        {view === "review" && (
          <AlertTriangle className="mx-auto mb-6 h-16 w-16 text-amber-400" />
        )}
        {view === "error" && <XCircle className="mx-auto mb-6 h-16 w-16 text-zinc-700" />}
        <h1 className="text-2xl font-bold">
          {view === "review"
            ? "Payment under review"
            : view === "error"
              ? "We could not confirm the order"
              : view === "delayed"
                ? "Still confirming your order"
                : "Confirming your order"}
        </h1>
        <p role="status" className="mt-4 text-zinc-600">
          {message}
        </p>
        {view === "delayed" && (
          <button
            type="button"
            className="mt-6 rounded bg-zinc-950 px-4 py-3 text-white"
            onClick={() => {
              setView("waiting");
              setMessage("Confirming your payment securely...");
              setRetry((value) => value + 1);
            }}
          >
            Check order status
          </button>
        )}
        <p className="mt-6 text-xs text-zinc-500">Order ID: {orderId}</p>
      </div>
    </main>
  );
}

export default function CheckoutProcessingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--storefront-surface)]">
          <Loader2 className="h-12 w-12 animate-spin text-zinc-950" />
        </div>
      }
    >
      <ProcessingContent />
    </Suspense>
  );
}
