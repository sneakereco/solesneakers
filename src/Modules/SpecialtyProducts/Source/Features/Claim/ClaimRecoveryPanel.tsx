"use client";
import { useCallback, useEffect, useId, useState } from "react";
import {
  ATTEMPT_CHANGED_EVENT,
  readSavedAttempts,
  type SavedAttempt,
} from "./attempt-storage";
import { ClaimDialog } from "./ClaimDialog";

export function useSavedClaimAttempts() {
  const [attempts, setAttempts] = useState<SavedAttempt[]>([]);
  useEffect(() => {
    const update = () => setAttempts(readSavedAttempts());
    update();
    window.addEventListener(ATTEMPT_CHANGED_EVENT, update);
    return () => window.removeEventListener(ATTEMPT_CHANGED_EVENT, update);
  }, []);
  return attempts;
}

export function ClaimRecoveryPanel({ attempts }: { attempts: SavedAttempt[] }) {
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const selectorId = useId();
  const close = useCallback(() => {
    setSelectedProductId(null);
    // A resize can hide the original trigger while its portal remains open.
    requestAnimationFrame(() => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      Array.from(document.querySelectorAll<HTMLButtonElement>("[data-giveaway-status]"))
        .find((button) => button.getClientRects().length > 0)
        ?.focus();
    });
  }, []);
  const selected = attempts.find((item) => item.productId === selectedProductId);
  const latest = attempts.at(-1);
  if (!latest) return null;
  return (
    <>
      <button
        type="button"
        data-giveaway-status
        className="inline-flex min-h-11 items-center whitespace-nowrap text-xs font-semibold uppercase text-zinc-700 transition-colors hover:text-black"
        onClick={() => setSelectedProductId(latest.productId)}
      >
        Check giveaway status
      </button>
      {selected && (
        <ClaimDialog
          key={selected.productId}
          product={{
            id: selected.productId,
            name: "giveaway prize",
            description: null,
            imageUrl: null,
            claimable: false,
          }}
          open
          onClose={close}
          initialHeading="Giveaway status"
          recoverySelector={
            attempts.length > 1 ? (
              <div className="mt-5">
                <label htmlFor={selectorId} className="block text-sm font-medium">
                  Choose a giveaway claim
                </label>
                <select
                  id={selectorId}
                  className="mt-2 min-h-11 w-full rounded border border-zinc-300 bg-white px-3 text-sm"
                  value={selected.productId}
                  onChange={(event) => setSelectedProductId(event.target.value)}
                >
                  {attempts.map((item, index) => (
                    <option key={item.productId} value={item.productId}>
                      Claim {index + 1}
                      {item === latest ? " (most recent)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : undefined
          }
        />
      )}
    </>
  );
}
