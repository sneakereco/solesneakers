"use client";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useSession } from "@/contexts/SessionContext";

// A continuation belongs to this mounted checkout. A new shopper gets a new instance.
export function useCheckoutOwnerAccess(ownerId: string | null) {
  const { status, user, isCurrent } = useSession();
  const ownerMatches = status === "ready" && (user?.id ?? null) === ownerId;
  const observation = useRef<{
    awaitingVerification: boolean;
    matches: boolean;
    isCurrent: () => boolean;
  } | null>(null);
  const waiters = useRef(new Set<() => void>());
  const wake = useCallback(() => {
    for (const resolve of waiters.current) resolve();
    waiters.current.clear();
  }, []);
  useLayoutEffect(() => {
    observation.current = {
      awaitingVerification: status !== "ready",
      matches: ownerMatches,
      isCurrent,
    };
    wake();
  }, [status, ownerMatches, isCurrent, wake]);
  useLayoutEffect(
    () => () => {
      observation.current = null;
      wake();
    },
    [wake],
  );
  return useCallback(async () => {
    for (;;) {
      const current = observation.current;
      if (!current || (!current.matches && !current.awaitingVerification))
        throw new Error("Checkout access has changed.");
      if (current.matches && current.isCurrent()) return;
      await new Promise<void>((resolve) => waiters.current.add(resolve));
    }
  }, []);
}
