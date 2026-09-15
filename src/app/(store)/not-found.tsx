import Link from "next/link";
// app/not-found.tsx
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <main className="w-full max-w-3xl">
        <div className="rounded-2xl border border-zinc-800 bg-black/80 px-6 py-8 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur sm:px-10 sm:py-10">
          <p className="text-center text-[11px] uppercase tracking-[0.18em] text-red-400">
            Realdealkickzsc
          </p>

          <div className="mt-4 flex items-center justify-center text-[11px] uppercase tracking-[0.22em] text-zinc-400">
            <span>404</span>
            <span aria-hidden className="mx-3 text-zinc-600">
              •
            </span>
            <span>Lost drop</span>
          </div>

          <h1 className="mt-6 text-center text-3xl font-semibold tracking-tight sm:text-5xl">
            This page is out of stock
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-center text-zinc-300">
            The link you followed doesn&apos;t exist anymore. Let&apos;s get you back to
            heat.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white/30"
            >
              Back to home
            </Link>

            <Link
              href="/store"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-white/20"
            >
              Shop new arrivals
            </Link>
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/bug-report"
              className="text-sm text-zinc-400 underline underline-offset-4 transition-colors hover:text-white"
            >
              Think this is a bug? Report it.
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
