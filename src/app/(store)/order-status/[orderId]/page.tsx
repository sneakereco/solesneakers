// app/order-status/[orderId]/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import type { OrderStatusResponse } from "@/types/domain/checkout";
import { OrderStatusView } from "@/components/orders/OrderStatusView";

function OrderStatusContent() {
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const orderId = params?.orderId;

  const [status, setStatus] = useState<OrderStatusResponse | null>(null);
  const [loadError, setError] = useState<string | null>(null);
  const error = !token
    ? "Missing secure order link. Please check your email."
    : loadError;

  useEffect(() => {
    if (!orderId) {
      return;
    }
    if (!token) {
      return;
    }

    const loadStatus = async () => {
      try {
        const response = await fetch(
          `/api/orders/${orderId}?token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "Unable to load order status.");
        }
        setStatus(data);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unable to load order status.";
        setError(message);
      }
    };

    void loadStatus();
  }, [orderId, token]);

  if (!orderId) {
    return null;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="rounded border border-red-500 bg-red-900/20 p-6 text-red-400">
          <p className="mb-2 text-lg font-semibold">Order status unavailable</p>
          <p>{error}</p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 rounded bg-red-600 px-6 py-2 text-white transition hover:bg-red-700"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <Loader2 className="mx-auto h-16 w-16 animate-spin text-red-600" />
      </div>
    );
  }

  return <OrderStatusView status={status} />;
}

export default function OrderStatusPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <Loader2 className="mx-auto h-16 w-16 animate-spin text-red-600" />
        </div>
      }
    >
      <OrderStatusContent />
    </Suspense>
  );
}
