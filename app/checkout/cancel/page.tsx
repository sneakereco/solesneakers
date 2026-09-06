// src/app/checkout/cancel/page.tsx (NEW)

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";

import { clearIdempotencyKeyFromStorage } from "@/lib/checkout/idempotency";
import { clearGuestShippingAddress } from "@/lib/checkout/guest-shipping-address";

export default function CheckoutCancelPage() {
  const router = useRouter();

  useEffect(() => {
    clearIdempotencyKeyFromStorage();
    clearGuestShippingAddress();
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center text-zinc-950">
      <XCircle className="w-16 h-16 text-yellow-500 mx-auto mb-6" />
      <h1 className="mb-4 text-3xl font-bold">Checkout Canceled</h1>
      <p className="mb-8 text-zinc-600">
        Your order has been canceled. No charges were made to your account.
      </p>

      <div className="space-y-3">
        <button
          onClick={() => router.push("/cart")}
          className="w-full bg-zinc-950 py-3 font-bold text-white transition hover:bg-black"
        >
          Return to Cart
        </button>
        <button
          onClick={() => router.push("/store")}
          className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-3 rounded transition"
        >
          Continue Shopping
        </button>
      </div>
    </div>
  );
}
