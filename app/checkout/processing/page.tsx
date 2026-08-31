"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";

import { classifyCheckoutOrderStatus } from "@/lib/checkout/checkout-order-state";
import { readGuestOrderAccess } from "@/lib/checkout/client-session";

type ViewState = "waiting" | "review" | "error";

function ProcessingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const [view, setView] = useState<ViewState>("waiting");
  const [message, setMessage] = useState("Waiting for Square to confirm your payment...");

  useEffect(() => {
    if (!orderId) {
      router.replace("/cart");
      return;
    }

    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const token = readGuestOrderAccess(orderId);

    const poll = async () => {
      if (canceled) {
        return;
      }
      if (attempts >= 60) {
        setView("error");
        setMessage(
          "Confirmation is taking longer than expected. Check your email before trying again.",
        );
        return;
      }
      attempts += 1;

      try {
        const query = token ? `?token=${encodeURIComponent(token)}` : "";
        const response = await fetch(`/api/orders/${orderId}${query}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          if (response.status === 401) {
            setView("error");
            setMessage(
              "This browser cannot open the order details. Check your email for your secure order link.",
            );
            return;
          }
          throw new Error(data?.error || "Unable to check order status");
        }

        const state = classifyCheckoutOrderStatus(String(data?.status ?? ""));
        if (state === "paid") {
          router.replace(`/checkout/success?orderId=${encodeURIComponent(orderId)}`);
          return;
        }
        if (state === "review") {
          setView("review");
          setMessage(
            "Your payment was received and is being reviewed. Do not submit another payment.",
          );
          return;
        }
        if (state === "exception") {
          setView("error");
          setMessage(
            "This checkout could not be completed. Check your email or contact support before trying again.",
          );
          return;
        }

        timer = setTimeout(() => void poll(), 2_000);
      } catch {
        timer = setTimeout(() => void poll(), 2_000);
      }
    };

    void poll();
    return () => {
      canceled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [orderId, router]);

  if (!orderId) {
    return null;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 text-white">
      <div className="w-full max-w-md text-center">
        {view === "waiting" && (
          <Loader2 className="mx-auto mb-6 h-16 w-16 animate-spin text-red-600" />
        )}
        {view === "review" && (
          <AlertTriangle className="mx-auto mb-6 h-16 w-16 text-amber-400" />
        )}
        {view === "error" && <XCircle className="mx-auto mb-6 h-16 w-16 text-red-500" />}
        <h1 className="text-2xl font-bold">
          {view === "review"
            ? "Payment under review"
            : view === "error"
              ? "We could not confirm the order"
              : "Confirming your order"}
        </h1>
        <p className="mt-4 text-zinc-400">{message}</p>
        <p className="mt-6 text-xs text-zinc-600">Order ID: {orderId}</p>
      </div>
    </main>
  );
}

export default function CheckoutProcessingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-950">
          <Loader2 className="h-12 w-12 animate-spin text-red-600" />
        </div>
      }
    >
      <ProcessingContent />
    </Suspense>
  );
}
