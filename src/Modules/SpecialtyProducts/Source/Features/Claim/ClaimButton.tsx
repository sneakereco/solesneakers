"use client";
import { useCallback, useEffect, useState } from "react";
import type { SpecialtyPublicProduct } from "./claim-contract";
import { ATTEMPT_CHANGED_EVENT, readAttempt } from "./attempt-storage";
import { ClaimDialog } from "./ClaimDialog";
export function ClaimButton({ product }: { product: SpecialtyPublicProduct }) {
  const [open, setOpen] = useState(false),
    [hasAttempt, setHasAttempt] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    const update = () => setHasAttempt(Boolean(readAttempt(product.id)));
    update();
    window.addEventListener(ATTEMPT_CHANGED_EVENT, update);
    return () => window.removeEventListener(ATTEMPT_CHANGED_EVENT, update);
  }, [product.id]);
  return (
    <>
      <button
        type="button"
        disabled={!product.claimable && !hasAttempt}
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded bg-zinc-950 px-5 py-2 text-sm text-white disabled:opacity-50"
      >
        {product.claimable ? "Claim" : hasAttempt ? "Check claim result" : "Unavailable"}
      </button>
      {open && <ClaimDialog product={product} open onClose={close} />}
    </>
  );
}
