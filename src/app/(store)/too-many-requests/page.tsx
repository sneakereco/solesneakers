// app/too-many-requests/page.tsx
"use client";

import Link from "next/link";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { BRAND_NAME } from "@/config/constants/brand";

function TooManyRequestsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const fromParam = searchParams.get("from");
  // Prevent open redirect: only allow same-origin paths
  const safeFrom = fromParam && fromParam.startsWith("/") ? fromParam : "/";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--storefront-surface)] px-6 text-zinc-900">
      <main className="w-full max-w-3xl">
        <div className="border border-zinc-200 bg-white px-6 py-8 sm:px-10 sm:py-10">
          <p className="text-center text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {BRAND_NAME}
          </p>

          <div className="mt-4 flex items-center justify-center text-[11px] uppercase tracking-[0.22em] text-zinc-500">
            <span>429</span>
            <span aria-hidden className="mx-3 text-zinc-300">
              •
            </span>
            <span>Request limit</span>
          </div>

          <h1 className="mt-6 text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            Too many requests
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-center text-zinc-600">
            You&apos;ve sent too many requests in a short period. Please try again
            shortly.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-800"
            >
              Back to home
            </Link>

            <button
              type="button"
              onClick={() => router.push(safeFrom)}
              className="inline-flex items-center justify-center border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-100"
            >
              Retry
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function TooManyRequestsPage() {
  return (
    <Suspense fallback={null}>
      <TooManyRequestsContent />
    </Suspense>
  );
}
