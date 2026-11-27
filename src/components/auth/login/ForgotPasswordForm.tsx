"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { AuthError } from "@/components/auth/ui/AuthError";
import { AuthHeader } from "@/components/auth/ui/AuthHeader";
import { authStyles } from "@/components/auth/ui/authStyles";
import { ActionButton } from "@/components/ui/ActionButton";
import { FeedbackLink } from "@/components/ui/FeedbackLink";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { postAuthJson } from "@/lib/http/post-auth-json";
import { ResponseError } from "@/lib/http/read-json-response";
import { isPasswordValid } from "@/lib/validation/password";

import { PasswordRequirements } from "../register/PasswordRequirements";
import { PasswordField } from "./PasswordField";
import { SplitCodeInputWithResend } from "./SplitCodeInputWithResend";
import { useResendCooldown } from "./use-resend-cooldown";

interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
}

export function ForgotPasswordForm({ onBackToLogin }: ForgotPasswordFormProps) {
  const router = useRouter();
  const action = useAsyncAction();
  const [step, setStep] = useState<"request" | "reset" | "complete">("request");
  const [operation, setOperation] = useState<"submit" | "resend">("submit");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryOwnerId, setRecoveryOwnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const cooldown = useResendCooldown();
  const [continuing, setContinuing] = useState(false);
  const submitting = (action.pending && operation === "submit") || continuing;
  const resending = action.pending && operation === "resend";

  async function requestCode(fallback: string) {
    const result = await postAuthJson(
      "/api/auth/forgot-password",
      { email: email.trim() },
      fallback,
    );
    if (result.ok !== true) throw new Error(fallback);
    cooldown.restart();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (continuing || step === "complete") return;

    void action.run(async () => {
      setOperation("submit");
      setError(null);

      try {
        if (step === "request") {
          await requestCode("Could not send a reset code.");
          setStep("reset");
          return;
        }

        if (!recoveryOwnerId && code.length !== 6) {
          throw new Error("Please enter the 6-digit reset code from your email.");
        }
        if (password !== confirmation) throw new Error("Passwords do not match.");
        if (!isPasswordValid(password))
          throw new Error("Password does not meet the required criteria.");

        let expectedOwnerId = recoveryOwnerId;
        if (!expectedOwnerId) {
          const verified = await postAuthJson<{
            ok?: boolean;
            requiresTwoFASetup?: boolean;
            requiresTwoFAChallenge?: boolean;
            recoveryOwnerId?: string;
          }>(
            "/api/auth/forgot-password/verify-code",
            { email: email.trim(), code },
            "Invalid or expired reset code.",
          );
          if (verified.ok !== true) throw new Error("Invalid or expired reset code.");

          if (verified.requiresTwoFASetup || verified.requiresTwoFAChallenge) {
            setContinuing(true);
            router.push(
              verified.requiresTwoFASetup ? "/auth/2fa/setup" : "/auth/2fa/challenge",
            );
            return;
          }
          if (typeof verified.recoveryOwnerId !== "string" || !verified.recoveryOwnerId) {
            setCode("");
            throw new Error(
              "Could not verify the recovery session. Request a new reset code.",
            );
          }
          expectedOwnerId = verified.recoveryOwnerId;
          setRecoveryOwnerId(expectedOwnerId);
        }

        const updated = await postAuthJson(
          "/api/auth/update-password",
          { password, recoveryOwnerId: expectedOwnerId },
          "Could not update your password. Please try again.",
        );
        if (updated.ok !== true)
          throw new Error("Could not update your password. Please try again.");

        setPassword("");
        setConfirmation("");
        setCode("");
        setStep("complete");
        window.dispatchEvent(new Event("sessionUpdate"));
      } catch (failure) {
        setContinuing(false);
        if (failure instanceof ResponseError && failure.status === 409) {
          setRecoveryOwnerId(null);
          setCode("");
        }
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not reset your password. Please try again.",
        );
      }
    });
  }

  function handleResend() {
    if (step !== "reset" || cooldown.seconds > 0 || !email || continuing) return;

    void action.run(async () => {
      setOperation("resend");
      setResendResult(null);
      try {
        await requestCode("Could not resend a reset code.");
        setRecoveryOwnerId(null);
        setCode("");
        setResendResult({
          ok: true,
          message: "If an account exists for that email, we sent a new reset code.",
        });
      } catch (failure) {
        setResendResult({
          ok: false,
          message:
            failure instanceof Error ? failure.message : "Could not resend a reset code.",
        });
      }
    });
  }

  if (step === "complete") {
    return (
      <div className="space-y-5">
        <AuthHeader title="Reset password" />
        <p role="status" className={authStyles.infoBox}>
          Your password has been updated.
        </p>
        <FeedbackLink href="/auth/login" className={authStyles.accentLink}>
          Continue to sign in
        </FeedbackLink>
      </div>
    );
  }

  const errorId = error ? "reset-password-error" : undefined;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <AuthHeader
        title={step === "request" ? "Forgot password" : "Reset password"}
        description={
          step === "request"
            ? "Enter your email and we will send you a reset code."
            : "Enter the code from your email and choose a new password."
        }
      />
      <AuthError id="reset-password-error" message={error} />

      <div>
        <label htmlFor="forgot-email" className={authStyles.label}>
          Email
        </label>
        <input
          id="forgot-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          readOnly={step === "reset" || submitting}
          aria-describedby={step === "request" ? errorId : undefined}
          className={authStyles.input}
        />
      </div>

      {step === "reset" && (
        <>
          <p role="status" className={authStyles.infoBox}>
            {recoveryOwnerId
              ? "Reset code confirmed."
              : "If an account exists for that email, we sent a reset code."}
          </p>
          <SplitCodeInputWithResend
            id="reset-code"
            label="Reset code"
            value={code}
            onChange={setCode}
            onResend={handleResend}
            isSending={resending}
            cooldown={cooldown.seconds}
            disabled={submitting}
            readOnly={submitting || Boolean(recoveryOwnerId)}
            resendResult={resendResult}
            aria-describedby={errorId}
          />
          <PasswordField
            name="new-password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={submitting}
            describedBy={errorId}
          />
          <PasswordField
            name="confirm-password"
            label="Confirm password"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            disabled={submitting}
            describedBy={errorId}
          />
          <PasswordRequirements password={password} />
        </>
      )}

      <ActionButton
        type="submit"
        disabled={resending}
        pending={submitting}
        pendingLabel={step === "request" ? "Sending code…" : "Updating password…"}
        className={authStyles.primaryButton}
      >
        {step === "request" ? "Send reset code" : "Update password"}
      </ActionButton>

      <div className="flex justify-center">
        <ActionButton
          type="button"
          onClick={onBackToLogin}
          disabled={action.pending || continuing}
          className={authStyles.secondaryButton}
        >
          Back to sign in
        </ActionButton>
      </div>
    </form>
  );
}
