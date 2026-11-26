// src/app/checkout/cancel/page.tsx (NEW)

"use client";

import { FeedbackLink } from "@/components/ui/FeedbackLink";
import { XCircle } from "lucide-react";
import { CheckoutPaymentDialog } from "@/components/checkout/CheckoutPaymentDialog";

export default function CheckoutCancelPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center text-zinc-950">
      <CheckoutPaymentDialog open={false} />
      <XCircle className="mx-auto mb-6 h-16 w-16 text-yellow-500" />
      <h1 className="mb-4 text-3xl font-bold">Checkout Canceled</h1>
      <p className="mb-8 text-zinc-600">
        You left checkout. If you submitted a payment, check your order email before
        trying again.
      </p>

      <div className="space-y-3">
        <FeedbackLink
          href="/cart"
          className="block w-full bg-zinc-950 py-3 text-center font-bold text-white transition hover:bg-black"
        >
          Return to Cart
        </FeedbackLink>
        <FeedbackLink
          href="/store"
          className="block w-full rounded bg-zinc-800 py-3 text-center font-semibold text-white transition hover:bg-zinc-700"
        >
          Continue Shopping
        </FeedbackLink>
      </div>
    </div>
  );
}
