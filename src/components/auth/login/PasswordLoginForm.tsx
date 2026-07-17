// src/components/auth/login/PasswordLoginForm.tsx
"use client";

import { useReducer } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { AuthHeader } from "@/components/auth/ui/AuthHeader";
import { authStyles } from "@/components/auth/ui/authStyles";

interface PasswordLoginFormProps {
  onRequiresEmailVerification: (email: string) => void;
  onSwitchToOtp: () => void;
  onForgotPassword: () => void;
}

type State = {
  password: string;
  isSubmitting: boolean;
  error: string | null;
};

type Action =
  | { type: "SET_PASSWORD"; password: string }
  | { type: "START_SUBMIT" }
  | { type: "ERROR"; error: string }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_PASSWORD":
      return { ...state, password: action.password };
    case "START_SUBMIT":
      return { ...state, isSubmitting: true, error: null };
    case "ERROR":
      return { ...state, isSubmitting: false, error: action.error };
    case "RESET":
      return { ...state, isSubmitting: false, error: null };
    default:
      return state;
  }
}

export function PasswordLoginForm({
  onRequiresEmailVerification,
  onSwitchToOtp,
  onForgotPassword,
}: PasswordLoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(reducer, {
    password: "",
    isSubmitting: false,
    error: null,
  });

  const nextUrl = searchParams.get("next") || "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    dispatch({ type: "START_SUBMIT" });

    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);

    const email = String(formData.get("email") ?? "").trim();
    const passwordValue = String(formData.get("password") ?? "");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: passwordValue }),
      });

      const json = await res.json();

      if (json.requiresEmailVerification) {
        onRequiresEmailVerification(email);
        dispatch({ type: "RESET" });
        return;
      }

      if (!json.ok) {
        dispatch({ type: "ERROR", error: json.error ?? "Login failed" });
        return;
      }

      if (json.isAdmin && json.requiresTwoFASetup) {
        return router.push("/auth/2fa/setup");
      }
      if (json.isAdmin && json.requiresTwoFAChallenge) {
        return router.push("/auth/2fa/challenge");
      }

      const destination = json.isAdmin ? "/admin" : nextUrl;
      router.push(destination);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      dispatch({ type: "ERROR", error: message });
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      <AuthHeader title="Login" description="Enter your email and password to login:" />

      {state.error && <div className={authStyles.errorBox}>{state.error}</div>}

      <div className="space-y-4">
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={authStyles.input}
          placeholder="E-mail"
          data-testid="login-email"
          disabled={state.isSubmitting}
        />

        <div className="flex h-14 items-center justify-between border border-zinc-300 bg-white px-5 sm:h-[min(3.2vw,3.85rem)] sm:min-h-12">
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            value={state.password}
            onChange={(e) => dispatch({ type: "SET_PASSWORD", password: e.target.value })}
            className="h-full min-w-0 flex-1 bg-transparent text-[1.02rem] text-zinc-800 placeholder:text-zinc-500 focus:outline-none"
            placeholder="Password"
            data-testid="login-password"
            disabled={state.isSubmitting}
          />
          <button
            type="button"
            onClick={onForgotPassword}
            className="ml-4 shrink-0 text-[0.95rem] text-zinc-600 transition-colors hover:text-zinc-900"
          >
            Forgot your password?
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={state.isSubmitting}
        className={authStyles.primaryButton}
        data-testid="login-submit"
      >
        {state.isSubmitting ? "Logging in..." : "Login"}
      </button>

      <p className="pt-2 text-center text-[0.98rem] text-zinc-600">
        Don't have an account?{" "}
        <Link
          href={`/auth/register${nextUrl !== "/" ? `?next=${encodeURIComponent(nextUrl)}` : ""}`}
          className={authStyles.inlineAccentLink}
        >
          Sign up
        </Link>
      </p>
      <button
        type="button"
        onClick={onSwitchToOtp}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      >
        Sign in with email code instead
      </button>
    </form>
  );
}
