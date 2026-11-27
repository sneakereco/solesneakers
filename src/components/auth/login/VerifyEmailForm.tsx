// src/components/auth/login/VerifyEmailForm.tsx
"use client";

import { notifySessionUpdate } from "@/lib/auth/session-events";
import { useSearchParams } from "next/navigation";
import { navigateAfterAuth } from "@/lib/auth/navigate-after-auth";
import { postAuthJson } from "@/lib/http/post-auth-json";

import { EmailCodeFlow } from "./EmailCodeFlow";

type VerifyFlow = "signup" | "signin";

export interface VerifyEmailFormProps {
  email: string;
  flow?: VerifyFlow;
  onVerified?: (nextPath?: string) => void;
  onBackToLogin?: () => void;
}

export function VerifyEmailForm({
  email,
  flow = "signin",
  onVerified,
  onBackToLogin,
}: VerifyEmailFormProps) {
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/";

  const heading = flow === "signin" ? "Verify your email" : "Activate your account";

  const baseDescription =
    flow === "signin"
      ? "Enter the code we sent to continue."
      : "Enter the code we emailed to activate your account.";

  async function resendVerification(targetEmail: string) {
    const result = await postAuthJson(
      "/api/auth/resend-verification",
      { email: targetEmail, flow },
      "Could not resend verification code.",
    );
    if (result.ok !== true) throw new Error("Could not resend verification code.");
  }

  async function verifyCode(targetEmail: string, code: string) {
    const json = await postAuthJson(
      "/api/auth/verify-email",
      { email: targetEmail.trim(), code: code.trim(), flow },
      "Could not verify code.",
    );
    if (json.ok !== true) throw new Error("Could not verify code.");

    notifySessionUpdate();
    // After successful verification, redirect to where they came from
    const destination = json.nextPath || nextUrl;
    if (onVerified) {
      onVerified(destination);
    } else {
      navigateAfterAuth(destination);
    }
  }

  return (
    <EmailCodeFlow
      flowId="verify-email"
      title={heading}
      codeLabel="Verification code"
      emailLabel="Email"
      initialStage="verify"
      initialEmail={email}
      showEmailInput={true}
      emailReadOnly={true}
      getDescription={() => baseDescription}
      verifyButtonLabel="Verify & continue"
      verifyButtonSubmittingLabel="Verifying..."
      onVerifyCode={verifyCode}
      onResendCode={resendVerification}
      initialCooldown={60}
      codeLength={6}
      backLabel="Back to sign in"
      onBack={onBackToLogin}
      backHref={
        onBackToLogin
          ? undefined
          : `/auth/login${nextUrl !== "/" ? `?next=${encodeURIComponent(nextUrl)}` : ""}`
      }
    />
  );
}
