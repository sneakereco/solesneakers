"use client";

import { useState, type FormEvent } from "react";

import { authStyles } from "@/components/auth/ui/authStyles";
import { AuthError } from "@/components/auth/ui/AuthError";
import { AuthHeader } from "@/components/auth/ui/AuthHeader";
import { ActionButton } from "@/components/ui/ActionButton";
import { FeedbackLink } from "@/components/ui/FeedbackLink";
import { useAsyncAction } from "@/components/ui/useAsyncAction";

import { SplitCodeInputWithResend } from "./SplitCodeInputWithResend";
import { useResendCooldown } from "./use-resend-cooldown";

type Stage = "request" | "verify";

export interface EmailCodeFlowProps {
  flowId?: string;
  title: string;
  codeLabel: string;
  emailLabel?: string;
  getDescription: (stage: Stage, hasError: boolean) => string;
  initialStage?: Stage;
  initialEmail?: string;
  emailReadOnly?: boolean;
  showEmailInput?: boolean;
  sendButtonLabel?: string;
  sendButtonSendingLabel?: string;
  verifyButtonLabel?: string;
  verifyButtonSubmittingLabel?: string;
  onRequestCode?: (email: string) => Promise<void>;
  onVerifyCode: (email: string, code: string) => Promise<void>;
  onResendCode?: (email: string) => Promise<void>;
  initialCooldown?: number;
  codeLength?: number;
  backLabel?: string;
  backHref?: string;
  onBack?: () => void;
}

export function EmailCodeFlow({
  flowId,
  title,
  codeLabel,
  emailLabel = "Email",
  getDescription,
  initialStage,
  initialEmail = "",
  emailReadOnly,
  showEmailInput = true,
  sendButtonLabel = "Send code",
  sendButtonSendingLabel = "Sending code…",
  verifyButtonLabel = "Verify code",
  verifyButtonSubmittingLabel = "Verifying…",
  onRequestCode,
  onVerifyCode,
  onResendCode,
  initialCooldown = 0,
  codeLength = 6,
  backLabel,
  backHref,
  onBack,
}: EmailCodeFlowProps) {
  const action = useAsyncAction();
  const [operation, setOperation] = useState<"submit" | "resend">("submit");
  const [stage, setStage] = useState<Stage>(
    initialStage ?? (onRequestCode ? "request" : "verify"),
  );
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cooldown = useResendCooldown(initialCooldown);
  const [resendResult, setResendResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [continuing, setContinuing] = useState(false);
  const submitting = (action.pending && operation === "submit") || continuing;
  const resending = action.pending && operation === "resend";

  const prefix = flowId ?? "email-code-flow";
  const emailId = `${prefix}-email`;
  const errorId = `${prefix}-error`;
  const trimmedEmail = email.trim();
  const effectiveResend = onResendCode ?? onRequestCode;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (continuing) return;

    void action.run(async () => {
      setOperation("submit");
      setError(null);

      try {
        if (!trimmedEmail) throw new Error("Email is required.");

        if (stage === "request" && onRequestCode) {
          await onRequestCode(trimmedEmail);
          setStage("verify");
          setResendResult(null);
          cooldown.restart();
          return;
        }

        if (code.length !== codeLength) {
          throw new Error(`Please enter the ${codeLength}-digit code from your email.`);
        }

        await onVerifyCode(trimmedEmail, code);
        setContinuing(true);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not complete verification. Please try again.",
        );
      }
    });
  }

  function handleResend() {
    if (!effectiveResend || !trimmedEmail || cooldown.seconds > 0 || continuing) return;

    void action.run(async () => {
      setOperation("resend");
      setResendResult(null);

      try {
        await effectiveResend(trimmedEmail);
        setResendResult({ ok: true, message: "Code sent." });
        cooldown.restart();
      } catch (failure) {
        setResendResult({
          ok: false,
          message: failure instanceof Error ? failure.message : "Could not resend code.",
        });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" data-flow-id={flowId}>
      <AuthHeader title={title} description={getDescription(stage, Boolean(error))} />
      <AuthError id={errorId} message={error} />

      <div className="space-y-4">
        {showEmailInput && (
          <div>
            <label htmlFor={emailId} className={authStyles.label}>
              {emailLabel}
            </label>
            <input
              id={emailId}
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              readOnly={emailReadOnly || stage === "verify" || submitting}
              aria-describedby={stage === "request" && error ? errorId : undefined}
              className={authStyles.input}
            />
          </div>
        )}

        {stage === "verify" && (
          <SplitCodeInputWithResend
            id={`${prefix}-code`}
            label={codeLabel}
            length={codeLength}
            value={code}
            onChange={setCode}
            onResend={effectiveResend ? handleResend : undefined}
            isSending={resending}
            cooldown={cooldown.seconds}
            disabled={submitting}
            resendResult={resendResult}
            aria-describedby={error ? errorId : undefined}
          />
        )}
      </div>

      <div className="space-y-3">
        <ActionButton
          type="submit"
          disabled={resending}
          pending={submitting}
          pendingLabel={
            stage === "request" ? sendButtonSendingLabel : verifyButtonSubmittingLabel
          }
          className={authStyles.primaryButton}
        >
          {stage === "request" ? sendButtonLabel : verifyButtonLabel}
        </ActionButton>

        {(backHref || onBack) && (
          <div className="flex justify-start">
            {backHref ? (
              <FeedbackLink href={backHref} className={authStyles.neutralLink}>
                {backLabel ?? "Back"}
              </FeedbackLink>
            ) : (
              <ActionButton
                type="button"
                onClick={onBack}
                disabled={action.pending || continuing}
                className={authStyles.secondaryButton}
              >
                {backLabel ?? "Back"}
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
