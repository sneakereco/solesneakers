// src/components/auth/login/SplitCodeInputWithResend.tsx
"use client";

import type { ComponentPropsWithoutRef } from "react";
import { RotateCw } from "lucide-react";

import { SixDigitCodeField } from "@/components/auth/ui/SixDigitCodeField";

export interface SplitCodeInputWithResendProps
  extends Omit<ComponentPropsWithoutRef<"input">, "onChange" | "value"> {
  id?: string;
  label?: string;
  length?: number;
  value: string;
  onChange: (value: string) => void;

  onResend: () => void;
  isSending: boolean;
  cooldown: number;
  disabled?: boolean;

  resendSent?: boolean;
  resendError?: string | null;
}

export function SplitCodeInputWithResend({
  id = "code",
  label = "Code",
  length = 6,
  value,
  onChange,
  onResend,
  isSending,
  cooldown,
  disabled,
  resendSent,
  resendError,
  autoFocus = true,
  ...rest
}: SplitCodeInputWithResendProps & { autoFocus?: boolean }) {
  const resendDisabled = disabled || isSending || cooldown > 0;

  return (
    <div className="space-y-3">
      <SixDigitCodeField
        id={id}
        label={label}
        length={length}
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoFocus={autoFocus}
        {...rest}
      />

      <div className="flex items-center justify-between text-[0.82rem]">
        <div className="text-zinc-500">
          {resendSent && <span className="text-emerald-600">Code sent</span>}
          {resendError && <span className="text-red-600">{resendError}</span>}
        </div>

        <button
          type="button"
          onClick={onResend}
          disabled={resendDisabled}
          className="flex items-center gap-1.5 text-zinc-700 transition-colors hover:text-black disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          <RotateCw className={`w-3 h-3 ${isSending ? "animate-spin" : ""}`} />
          <span>
            {isSending
              ? "Sending..."
              : cooldown > 0
                ? `Resend (${cooldown}s)`
                : "Resend code"}
          </span>
        </button>
      </div>
    </div>
  );
}
