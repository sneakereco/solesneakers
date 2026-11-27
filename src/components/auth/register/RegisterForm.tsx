"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { isPasswordValid } from "@/lib/validation/password";
import { postAuthJson } from "@/lib/http/post-auth-json";
import { AuthError } from "@/components/auth/ui/AuthError";
import { AuthHeader } from "@/components/auth/ui/AuthHeader";
import { authStyles } from "@/components/auth/ui/authStyles";
import { ActionButton } from "@/components/ui/ActionButton";
import { FeedbackLink } from "@/components/ui/FeedbackLink";
import { useAsyncAction } from "@/components/ui/useAsyncAction";

import { PasswordField } from "../login/PasswordField";
import { PasswordRequirements } from "./PasswordRequirements";

export function RegisterForm() {
  const router = useRouter();
  const nextUrl = useSearchParams().get("next") || "/";
  const register = useAsyncAction();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const busy = register.pending || continuing;
  const errorId = error ? "registration-error" : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (continuing) return;
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    void register.run(async () => {
      if (password !== confirmPassword || !isPasswordValid(password)) {
        setError(
          password !== confirmPassword
            ? "Passwords do not match."
            : "Password does not meet minimum requirements.",
        );
        return;
      }
      setError(null);

      try {
        const result = await postAuthJson(
          "/api/auth/register",
          { email, password },
          "Could not create your account. Please try again.",
        );
        if (result.ok !== true)
          throw new Error("Could not create your account. Please try again.");

        setContinuing(true);
        const verifyUrl = `/auth/login?flow=verify-email&verifyFlow=signup&email=${encodeURIComponent(email)}${nextUrl !== "/" ? `&next=${encodeURIComponent(nextUrl)}` : ""}`;
        router.push(verifyUrl);
      } catch (failure) {
        setContinuing(false);
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not create your account. Please try again.",
        );
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <AuthHeader
        title="Sign up"
        description="Enter your email and create a password to sign up:"
      />
      <AuthError id="registration-error" message={error} />

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
            readOnly={busy}
            aria-describedby={errorId}
          />
        </div>

        <PasswordField
          name="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={busy}
          describedBy={errorId}
        />

        <PasswordField
          name="confirmPassword"
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          disabled={busy}
          describedBy={errorId}
        />

        <PasswordRequirements password={password} />
      </div>

      <ActionButton
        type="submit"
        pending={busy}
        pendingLabel="Creating account…"
        className={authStyles.primaryButton}
      >
        Sign up
      </ActionButton>

      <p className="text-center text-[0.76rem] uppercase tracking-[0.08em] text-zinc-500">
        By signing up, you agree to our{" "}
        <FeedbackLink href="/terms" className="underline hover:text-zinc-400">
          Terms
        </FeedbackLink>{" "}
        and{" "}
        <FeedbackLink href="/privacy" className="underline hover:text-zinc-400">
          Privacy Policy
        </FeedbackLink>
      </p>

      <p className="pt-3 text-center text-[0.98rem] text-zinc-600">
        Already have an account?{" "}
        <FeedbackLink
          href={`/auth/login${nextUrl !== "/" ? `?next=${encodeURIComponent(nextUrl)}` : ""}`}
          className={authStyles.inlineAccentLink}
        >
          Login
        </FeedbackLink>
      </p>
    </form>
  );
}
