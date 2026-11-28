"use client";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useSession } from "@/contexts/SessionContext";
import { withRequestDeadline } from "@/lib/http/request-deadline";

// A continuation belongs to this mounted checkout. A new shopper gets a new instance.
export function useCheckoutOwnerAccess(ownerId: string | null, quotePending: boolean) {
  const { status, user, isCurrent } = useSession();
  const ownerMatches = status === "ready" && (user?.id ?? null) === ownerId;
  const observation = useRef<{
    awaitingVerification: boolean;
    matches: boolean;
    quotePending: boolean;
    isCurrent: () => boolean;
  } | null>(null);
  const waiters = useRef(new Set<() => void>());
  const wake = useCallback(() => {
    for (const resolve of waiters.current) resolve();
    waiters.current.clear();
  }, []);
  useLayoutEffect(() => {
    observation.current = {
      awaitingVerification: status === "checking",
      matches: ownerMatches,
      quotePending,
      isCurrent,
    };
    wake();
  }, [status, ownerMatches, isCurrent, quotePending, wake]);
  useLayoutEffect(
    () => () => {
      observation.current = null;
      wake();
    },
    [wake],
  );
  return useCallback(async (options?: { waitForQuote: true }) => {
    try {
      await withRequestDeadline(async (signal) => {
        for (;;) {
          const current = observation.current;
          if (!current || (!current.matches && !current.awaitingVerification))
            throw new Error("Checkout access has changed.");
          if (
            current.matches &&
            current.isCurrent() &&
            (!options?.waitForQuote || !current.quotePending)
          )
            return;
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              signal.removeEventListener("abort", aborted);
              waiters.current.delete(done);
              resolve();
            };
            const aborted = () => {
              waiters.current.delete(done);
              reject(signal.reason);
            };
            signal.addEventListener("abort", aborted, { once: true });
            waiters.current.add(done);
          });
        }
      });
    } catch {
      throw new Error(
        "Checkout verification could not finish. Refresh checkout and check your original order before paying again.",
      );
    }
  }, []);
}
