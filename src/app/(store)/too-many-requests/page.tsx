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
    <div className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <main className="w-full max-w-3xl">
        <div className="rounded-2xl border border-zinc-800 bg-black/80 px-6 py-8 backdrop-blur sm:px-10 sm:py-10">
          <p className="text-center text-[11px] uppercase tracking-[0.18em] text-red-400">
            {BRAND_NAME}
          </p>

          <div className="mt-4 flex items-center justify-center text-[11px] uppercase tracking-[0.22em] text-zinc-400">
            <span>429</span>
            <span aria-hidden className="mx-3 text-zinc-600">
              •
            </span>
            <span>Request limit</span>
          </div>

          <h1 className="mt-6 text-center text-3xl font-semibold tracking-tight sm:text-4xl">
            Too many requests
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-center text-zinc-300">
            You&apos;ve sent too many requests in a short period. Please try again
            shortly.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200"
            >
              Back to home
            </Link>

            <button
              type="button"
              onClick={() => router.push(safeFrom)}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-900"
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
