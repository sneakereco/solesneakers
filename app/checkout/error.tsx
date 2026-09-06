"use client";

import Link from "next/link";
import { useEffect } from "react";

import { logError } from "@/lib/utils/log";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError(error, {
      layer: "frontend",
      event: "checkout_error",
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-20 text-center text-zinc-950">
      <h1 className="mb-3 text-3xl font-bold">Checkout error</h1>
      <p className="mb-8 text-zinc-600">
        We hit an issue loading checkout. Try again or return to your cart.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="bg-zinc-950 px-6 py-3 font-semibold text-white hover:bg-black"
        >
          Try again
        </button>
        <Link
          href="/cart"
          className="px-6 py-3 bg-zinc-900 border border-zinc-800 text-zinc-200 hover:text-white rounded"
        >
          Back to cart
        </Link>
      </div>
    </div>
  );
}
