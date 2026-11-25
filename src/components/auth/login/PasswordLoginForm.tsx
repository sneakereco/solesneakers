"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthError } from "@/components/auth/ui/AuthError";
import { AuthHeader } from "@/components/auth/ui/AuthHeader";
import { authStyles } from "@/components/auth/ui/authStyles";
import { ActionButton } from "@/components/ui/ActionButton";
import { FeedbackLink } from "@/components/ui/FeedbackLink";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { useSession } from "@/contexts/SessionContext";
import { postAuthJson } from "@/lib/http/post-auth-json";

import { PasswordField } from "./PasswordField";

interface PasswordLoginFormProps {
  onRequiresEmailVerification: (email: string) => void;
  onSwitchToOtp: () => void;
  onForgotPassword: () => void;
}

export function PasswordLoginForm({
  onRequiresEmailVerification,
  onSwitchToOtp,
  onForgotPassword,
}: PasswordLoginFormProps) {
  const router = useRouter();
  const { refreshSession } = useSession();
  const nextUrl = useSearchParams().get("next") || "/";

  const login = useAsyncAction();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const busy = login.pending || continuing;
  const errorId = error ? "password-login-error" : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (continuing) return;
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const passwordValue = String(formData.get("password") ?? "");

    void login.run(async () => {
      setError(null);

      try {
        const result = await postAuthJson(
          "/api/auth/login",
          { email, password: passwordValue },
          "Could not sign in. Please try again.",
          true,
        );

        if (result.requiresEmailVerification) {
          setContinuing(true);
          onRequiresEmailVerification(email);
          return;
        }
        if (result.ok !== true) throw new Error("Could not sign in. Please try again.");

        setContinuing(true);
        if (result.isAdmin && result.requiresTwoFASetup)
          return router.push("/auth/2fa/setup");
        if (result.isAdmin && result.requiresTwoFAChallenge)
          return router.push("/auth/2fa/challenge");

        void refreshSession();
        router.push(result.isAdmin ? "/admin" : nextUrl);
      } catch (failure) {
        setContinuing(false);
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not sign in. Please try again.",
        );
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <AuthHeader title="Login" description="Enter your email and password to login:" />
      <AuthError id="password-login-error" message={error} />

      <div className="space-y-4">
        <div>
          <label htmlFor="email" className={authStyles.label}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={authStyles.input}
            data-testid="login-email"
            readOnly={busy}
            aria-describedby={errorId}
          />
        </div>

        <PasswordField
          name="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          dataTestId="login-password"
          disabled={busy}
          describedBy={errorId}
        />

        <ActionButton
          type="button"
          onClick={onForgotPassword}
          disabled={busy}
          className={authStyles.secondaryButton}
        >
          Forgot your password?
        </ActionButton>
      </div>

      <ActionButton
        type="submit"
        pending={busy}
        pendingLabel="Logging in…"
        className={authStyles.primaryButton}
        data-testid="login-submit"
      >
        Login
      </ActionButton>

      <p className="pt-2 text-center text-[0.98rem] text-zinc-600">
        Don&apos;t have an account?{" "}
        <FeedbackLink
          href={`/auth/register${nextUrl !== "/" ? `?next=${encodeURIComponent(nextUrl)}` : ""}`}
          className={authStyles.inlineAccentLink}
        >
          Sign up
        </FeedbackLink>
      </p>
      <ActionButton
        type="button"
        onClick={onSwitchToOtp}
        disabled={busy}
        className={`w-full ${authStyles.secondaryButton}`}
      >
        Sign in with email code instead
      </ActionButton>
    </form>
  );
}
