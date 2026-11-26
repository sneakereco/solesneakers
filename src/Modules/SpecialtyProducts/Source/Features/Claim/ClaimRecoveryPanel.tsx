"use client";
import { useEffect, useState } from "react";
import {
  ATTEMPT_CHANGED_EVENT,
  readSavedAttempts,
  type SavedAttempt,
} from "./attempt-storage";
import { ClaimButton } from "./ClaimButton";
export function ClaimRecoveryPanel() {
  const [attempts, setAttempts] = useState<SavedAttempt[]>([]);
  useEffect(() => {
    const update = () => setAttempts(readSavedAttempts());
    update();
    window.addEventListener(ATTEMPT_CHANGED_EVENT, update);
    return () => window.removeEventListener(ATTEMPT_CHANGED_EVENT, update);
  }, []);
  if (!attempts.length) return null;
  return (
    <div className="mt-4 text-zinc-600">
      <details>
        <summary className="cursor-pointer text-sm underline">
          Check your giveaway claim results
        </summary>
        <div className="mt-3 flex flex-wrap justify-center gap-4">
          {attempts.map((attempt, index) => (
            <div key={attempt.attemptId}>
              <p className="text-xs">Claim {index + 1}</p>
              <ClaimButton
                product={{
                  id: attempt.productId,
                  name: "giveaway prize",
                  description: null,
                  imageUrl: null,
                  claimable: false,
                }}
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
