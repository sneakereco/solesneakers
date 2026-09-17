// app/error.tsx
"use client";

import Link from "next/link";

import { useEffect } from "react";

import { logError } from "@/lib/utils/log";
import { BRAND_NAME } from "@/config/constants/brand";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError(error, { layer: "frontend", event: "error_boundary" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--storefront-surface)] px-6 text-zinc-900">
      <main className="w-full max-w-3xl">
        <div className="border border-zinc-200 bg-white px-6 py-8 sm:px-10 sm:py-10">
          <p className="text-center text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {BRAND_NAME}
          </p>

          <div className="mt-4 flex items-center justify-center text-[11px] uppercase tracking-[0.22em] text-zinc-500">
            <span>500</span>
            <span aria-hidden className="mx-3 text-zinc-300">
              •
            </span>
            <span>Server error</span>
          </div>

          <h1 className="mt-6 text-center text-3xl font-semibold tracking-tight sm:text-5xl">
            Something went wrong
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-center text-zinc-600">
            Please try again, or head back to the store.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center justify-center bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400"
            >
              Try again
            </button>

            <Link
              href="/"
              className="inline-flex items-center justify-center border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-300"
            >
              Back to home
            </Link>
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/bug-report"
              className="text-sm text-zinc-600 underline underline-offset-4 transition-colors hover:text-black"
            >
              Think this is a bug? Report it.
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
