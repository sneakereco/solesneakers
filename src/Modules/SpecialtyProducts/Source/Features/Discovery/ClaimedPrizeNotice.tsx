"use client";
import { useEffect, useState } from "react";
import { ATTEMPT_CHANGED_EVENT, readAttempt } from "../Claim/attempt-storage";

export function ClaimedPrizeNotice({ productId }: { productId: string }) {
  const [hasAttempt, setHasAttempt] = useState<boolean | null>(null);
  useEffect(() => {
    const update = () => setHasAttempt(Boolean(readAttempt(productId)));
    update();
    window.addEventListener(ATTEMPT_CHANGED_EVENT, update);
    return () => window.removeEventListener(ATTEMPT_CHANGED_EVENT, update);
  }, [productId]);
  return (
    <div className="space-y-3">
      <p className="text-zinc-700">This product has already been claimed.</p>
      {hasAttempt && (
        <p className="text-sm text-zinc-600">
          You submitted a claim. Check your claim result below to see your confirmation.
        </p>
      )}
    </div>
  );
}
