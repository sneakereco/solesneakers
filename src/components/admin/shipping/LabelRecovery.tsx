"use client";
import { useState } from "react";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { ActionButton } from "@/components/ui/ActionButton";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
type LabelEvidence = {
  id: string;
  fulfillment_status?: string | null;
  tracking_number?: string | null;
  label_created_at?: string | null;
  label_url?: string | null;
};
export function LabelRecovery({
  orderId,
  evidence,
  onResolve,
}: {
  orderId: string;
  evidence?: string | null;
  onResolve: () => void;
}) {
  const read = useAsyncAction();
  const [order, setOrder] = useState<LabelEvidence | null>(null);
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const purchasedWithoutTracking = evidence?.startsWith("purchased_without_tracking:");
  const supportReference = purchasedWithoutTracking
    ? evidence?.slice("purchased_without_tracking:".length)
    : null;
  const existing = evidence === "existing";
  const hasLabel = !!(
    order?.label_url ||
    order?.tracking_number ||
    order?.label_created_at ||
    ["ready_to_ship", "shipped", "delivered"].includes(order?.fulfillment_status ?? "")
  );
  const check = async () => {
    setVerified(false);
    setOrder(null);
    setMessage("");
    try {
      const data = await fetchJsonWithDeadline<{ order: LabelEvidence }>(
        `/api/admin/transactions/${orderId}`,
        "Order status unavailable.",
        new AbortController().signal,
      );
      if (data.order?.id !== orderId) throw new Error("Order mismatch");
      setOrder(data.order);
    } catch {
      setMessage("Unable to check this order. Try again.");
    }
  };
  return (
    <section aria-label="Label recovery" className="space-y-3 text-sm">
      <p>
        {purchasedWithoutTracking
          ? "The label was purchased through Shippo without a tracking number. Contact support to recover tracking for this order."
          : existing
            ? "This order already has label or fulfillment evidence."
            : "Check the order and the matching Shippo transaction before purchasing another label."}
      </p>
      {supportReference && <p>Support reference: {supportReference}</p>}
      <ActionButton
        type="button"
        pending={read.pending}
        pendingLabel="Checking…"
        onClick={() => void read.run(check)}
      >
        Check order label
      </ActionButton>
      {message && <p role="alert">{message}</p>}
      {order && (
        <p role="status">
          {hasLabel
            ? `Order label or fulfillment recorded.${order.tracking_number ? " Tracking number " + order.tracking_number + "." : ""}`
            : purchasedWithoutTracking
              ? "Tracking is still missing from this order."
              : "No label is recorded on this order. Check Shippo for a purchase."}
        </p>
      )}
      {!purchasedWithoutTracking && !existing && order && !hasLabel && (
        <>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            I verified in Shippo that no label was purchased for this order.
          </label>
          <button
            type="button"
            className="min-h-11 px-2 underline"
            disabled={!verified || read.pending}
            onClick={onResolve}
          >
            Resolve label check
          </button>
        </>
      )}
    </section>
  );
}
