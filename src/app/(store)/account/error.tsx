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
      event: "account_error",
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="min-h-[36rem] bg-[var(--storefront-surface)] px-5 py-24 text-center text-black sm:px-8">
      <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">
        Customer account
      </p>
      <h1 className="mt-4 text-3xl font-normal tracking-[-0.03em] sm:text-5xl">
        Account unavailable
      </h1>
      <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-zinc-500 sm:text-base">
        We could not load your account details. Try again or sign in again.
      </p>
      <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex min-h-12 min-w-40 items-center justify-center bg-[#1f1f1d] px-7 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-black"
        >
          Try again
        </button>
        <Link
          href="/auth/login"
          className="inline-flex min-h-12 min-w-40 items-center justify-center border border-zinc-400 px-7 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-800 transition-colors hover:border-black hover:text-black"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
