"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { RequestError } from "@/components/ui/RequestError";

export function AccountLoadError({ ownerChanged = false }: { ownerChanged?: boolean }) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();
  const [reloading, setReloading] = useState(false);

  function retry() {
    if (ownerChanged) {
      setReloading(true);
      window.location.reload();
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="min-h-[36rem] bg-[var(--storefront-surface)] px-5 py-24 text-black sm:px-8">
      <div className="mx-auto max-w-xl space-y-5">
        <h1 className="text-3xl font-normal tracking-[-0.03em] sm:text-5xl">
          My Account
        </h1>
        <RequestError
          message={
            ownerChanged
              ? "Your account session changed. Reload to open your account."
              : "Could not load your account."
          }
          onRetry={retry}
          retrying={retrying || reloading}
        />
      </div>
    </div>
  );
}
