"use client";

import type { ComponentPropsWithoutRef } from "react";
import { RotateCw } from "lucide-react";

import { SixDigitCodeField } from "@/components/auth/ui/SixDigitCodeField";
import { ActionButton } from "@/components/ui/ActionButton";

export interface SplitCodeInputWithResendProps
  extends Omit<ComponentPropsWithoutRef<"input">, "onChange" | "value"> {
  id: string;
  label: string;
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onResend?: () => void;
  isSending: boolean;
  cooldown: number;
  resendResult?: { ok: boolean; message: string } | null;
}

export function SplitCodeInputWithResend({
  id,
  label,
  length = 6,
  value,
  onChange,
  onResend,
  isSending,
  cooldown,
  disabled,
  resendResult,
  autoFocus = true,
  ...rest
}: SplitCodeInputWithResendProps) {
  return (
    <div className="space-y-2">
      <SixDigitCodeField
        id={id}
        label={label}
        length={length}
        value={value}
        onChange={onChange}
        readOnly={disabled}
        autoFocus={autoFocus}
        {...rest}
      />

      {onResend && (
        <div className="flex items-center justify-between gap-4 text-[0.82rem]">
          <div>
            {resendResult && (
              <p
                id={`${id}-resend-result`}
                role={resendResult.ok ? "status" : "alert"}
                className={resendResult.ok ? "text-emerald-700" : "text-red-700"}
              >
                {resendResult.message}
              </p>
            )}
          </div>
          <ActionButton
            type="button"
            onClick={onResend}
            disabled={disabled || cooldown > 0}
            pending={isSending}
            pendingLabel="Resending code…"
            aria-describedby={resendResult ? `${id}-resend-result` : undefined}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-zinc-700 transition-colors hover:text-black disabled:text-zinc-500"
          >
            <span className="inline-flex items-center gap-1.5">
              <RotateCw aria-hidden="true" className="h-3 w-3" />
              {cooldown > 0 ? `Resend (${cooldown}s)` : "Resend code"}
            </span>
          </ActionButton>
        </div>
      )}
    </div>
  );
}
