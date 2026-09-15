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
      event: "cart_error",
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-20 text-center">
      <h1 className="mb-3 text-3xl font-bold text-white">Cart error</h1>
      <p className="mb-8 text-zinc-400">
        We could not load your cart right now. Try again or continue shopping.
      </p>
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-700"
        >
          Try again
        </button>
        <Link
          href="/store"
          className="rounded border border-zinc-800 bg-zinc-900 px-6 py-3 text-zinc-200 hover:text-white"
        >
          Back to store
        </Link>
      </div>
    </div>
  );
}
