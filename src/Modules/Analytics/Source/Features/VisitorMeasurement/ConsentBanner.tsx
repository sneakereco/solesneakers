"use client";
import Link from "next/link";
import { useState } from "react";
import type { ConsentState } from "./contract";
export function ConsentBanner({
  state,
  busy,
  error,
  onChoice,
}: {
  state: ConsentState;
  busy: boolean;
  error: boolean;
  onChoice: (choice: "accepted" | "declined") => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const canAccept = typeof navigator !== "undefined" && Boolean(navigator.locks);
  const pending = state.choice === "declined" && state.pending;
  if (!open && state.choice !== "unknown" && !pending && !error)
    return (
      <button
        type="button"
        className="fixed bottom-3 left-3 z-40 rounded-full border border-neutral-300 bg-white px-3 py-2 text-xs text-black shadow-sm"
        onClick={() => setOpen(true)}
      >
        Privacy choices
      </button>
    );
  async function choose(value: "accepted" | "declined") {
    await onChoice(value);
    setOpen(false);
  }
  return (
    <section
      aria-label="Privacy choices"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-neutral-200 bg-white p-5 text-neutral-950 shadow-lg sm:inset-x-auto sm:left-4"
    >
      <h2 className="font-semibold">Shopping analytics</h2>
      <p className="mt-2 text-sm">
        {pending
          ? "Analytics are off on this device. We’ll retry saving your choice when you’re online."
          : !canAccept && state.choice !== "accepted"
            ? "Optional shopping analytics are off in this browser."
            : "Can we use PostHog to remember your visits, shopping activity, and how you found the store? When you’re signed in, we can connect those visits to your account. Declining won’t affect shopping. You can change your choice here anytime."}
      </p>
      <p className="mt-2 text-sm">
        <Link
          href="/privacy#shopping-analytics"
          prefetch={false}
          className="rounded-sm underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          How shopping analytics use your information
        </Link>
      </p>
      {error && (
        <p role="status" className="mt-2 text-sm">
          We couldn’t save your choice. Please try again.
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          disabled={busy}
          className="rounded-full border border-neutral-400 px-4 py-2 text-sm"
          onClick={() => void choose("declined")}
        >
          {pending ? "Retry saving" : "Decline"}
        </button>
        {!pending && canAccept && (
          <button
            disabled={busy}
            className="rounded-full bg-black px-4 py-2 text-sm text-white"
            onClick={() => void choose("accepted")}
          >
            Allow analytics
          </button>
        )}
      </div>
    </section>
  );
}
