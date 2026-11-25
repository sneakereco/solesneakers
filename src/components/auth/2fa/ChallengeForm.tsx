"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { AuthError } from "@/components/auth/ui/AuthError";
import { AuthHeader } from "@/components/auth/ui/AuthHeader";
import { authStyles } from "@/components/auth/ui/authStyles";
import { SixDigitCodeField } from "@/components/auth/ui/SixDigitCodeField";
import { ActionButton } from "@/components/ui/ActionButton";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { useSession } from "@/contexts/SessionContext";
import { mfaVerifyChallenge } from "@/services/mfa-service";

export function ChallengeForm() {
  const router = useRouter();
  const { refreshSession } = useSession();
  const verification = useAsyncAction();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const busy = verification.pending || continuing;

  function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (continuing || code.length !== 6) return;

    void verification.run(async () => {
      setError(null);
      try {
        await mfaVerifyChallenge(code);
        setContinuing(true);
        void refreshSession();
        router.push("/admin");
      } catch (failure) {
        setContinuing(false);
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not verify the authentication code. Please try again.",
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <AuthHeader
        title="Verify your identity"
        description="Enter the code from your authenticator app."
      />

      <form onSubmit={handleVerify} className="space-y-4">
        <SixDigitCodeField
          id="mfa-code"
          label="Authentication code"
          value={code}
          onChange={setCode}
          readOnly={busy}
          aria-describedby={error ? "mfa-challenge-error" : undefined}
          autoFocus
        />
        <AuthError id="mfa-challenge-error" message={error} />
        <ActionButton
          type="submit"
          disabled={code.length !== 6}
          pending={busy}
          pendingLabel="Verifying…"
          className={authStyles.primaryButton}
        >
          Verify
        </ActionButton>
      </form>
    </div>
  );
}
