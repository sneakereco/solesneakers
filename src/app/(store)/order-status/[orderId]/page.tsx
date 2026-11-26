"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "@/contexts/SessionContext";
import { OrderStatusView } from "@/components/orders/OrderStatusView";
import { OrderStatusSkeleton } from "@/components/checkout/CheckoutSkeletons";
import { RequestError } from "@/components/ui/RequestError";
import { buildCheckoutStatusUrl } from "@/lib/checkout/checkout-status-url";
import { withRequestDeadline } from "@/lib/http/request-deadline";
import { readJsonResponse, ResponseError } from "@/lib/http/read-json-response";
import type { OrderStatusResponse } from "@/types/domain/checkout";

function StatusRead({ orderId, token }: { orderId: string; token: string }) {
  const [status, setStatus] = useState<OrderStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void withRequestDeadline(
      async (signal) =>
        readJsonResponse<OrderStatusResponse>(
          await fetch(buildCheckoutStatusUrl(orderId, token, false), {
            cache: "no-store",
            signal,
          }),
          "Unable to load order status.",
        ),
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        if (
          data.id !== orderId ||
          ![data.subtotal, data.shipping, data.tax, data.total].every(Number.isFinite) ||
          !Array.isArray(data.events)
        )
          throw Error("Invalid order");
        setStatus(data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof ResponseError && [401, 403].includes(failure.status)
              ? "Open the secure order link from your email."
              : "Unable to load order status.",
          );
      });
    return () => controller.abort();
  }, [orderId, token, attempt]);
  if (error)
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <RequestError
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  return status ? <OrderStatusView status={status} /> : <OrderStatusSkeleton />;
}
function OrderStatusContent() {
  const { user, isLoading, isSessionUnavailable } = useSession();
  const orderId = useParams<{ orderId: string }>()?.orderId;
  const token = useSearchParams().get("token");
  if (!orderId || !token)
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <RequestError message="Missing secure order link. Please check your email." />
        <Link href="/" className="mt-4 inline-block underline">
          Back to Home
        </Link>
      </div>
    );
  if (isLoading) return <OrderStatusSkeleton />;
  // A new lookup state gets its own token-bearing request and cannot reuse a prior owner's result.
  const lookupState = isSessionUnavailable ? "unavailable" : "verified";
  return (
    <StatusRead
      key={JSON.stringify([orderId, token, lookupState, user?.id ?? null])}
      orderId={orderId}
      token={token}
    />
  );
}
export default function OrderStatusPage() {
  return (
    <Suspense fallback={<OrderStatusSkeleton />}>
      <OrderStatusContent />
    </Suspense>
  );
}
