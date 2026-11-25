// src/components/auth/login/OtpLoginForm.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/contexts/SessionContext";
import { postAuthJson } from "@/lib/http/post-auth-json";

import { EmailCodeFlow } from "./EmailCodeFlow";

interface OtpLoginFormProps {
  onRequiresEmailVerification: (email: string) => void;
  onBackToLogin?: () => void;
}

export function OtpLoginForm({
  onRequiresEmailVerification,
  onBackToLogin,
}: OtpLoginFormProps) {
  const router = useRouter();
  const { refreshSession } = useSession();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/";

  async function requestOtp(email: string) {
    const result = await postAuthJson(
      "/api/auth/otp/request",
      { email },
      "Could not send sign-in code.",
    );
    if (result.ok !== true) throw new Error("Could not send sign-in code.");
  }

  async function verifyOtp(email: string, code: string) {
    const json = await postAuthJson(
      "/api/auth/otp/verify",
      { email, code },
      "Could not verify sign-in code.",
      true,
    );

    if (json.requiresEmailVerification) {
      onRequiresEmailVerification(email);
      return;
    }

    if (json.ok !== true) {
      throw new Error("Invalid or expired code.");
    }

    if (json.isAdmin && json.requiresTwoFASetup) {
      return router.push("/auth/2fa/setup");
    }
    if (json.isAdmin && json.requiresTwoFAChallenge) {
      return router.push("/auth/2fa/challenge");
    }

    // Redirect to where they came from or admin/home
    const destination = json.isAdmin ? "/admin" : nextUrl;
    void refreshSession();
    router.push(destination);
  }

  return (
    <EmailCodeFlow
      flowId="otp-login"
      title="Sign in with code"
      codeLabel="Verification code"
      getDescription={(stage) =>
        stage === "request"
          ? "We'll email you a code. No password needed."
          : "Enter the code we sent to your email."
      }
      sendButtonLabel="Send code"
      sendButtonSendingLabel="Sending..."
      verifyButtonLabel="Sign in"
      verifyButtonSubmittingLabel="Signing in..."
      onRequestCode={requestOtp}
      onVerifyCode={verifyOtp}
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
