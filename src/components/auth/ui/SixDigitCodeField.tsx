// src/components/auth/ui/SixDigitCodeField.tsx
"use client";

import type { ComponentPropsWithoutRef } from "react";

import { authStyles } from "./authStyles";

export interface SixDigitCodeFieldProps
  extends Omit<ComponentPropsWithoutRef<"input">, "onChange" | "value"> {
  id: string;
  label?: string;
  length?: number;
  value: string;
  onChange: (value: string) => void;
}

export function SixDigitCodeField({
  id,
  label,
  length = 6,
  value,
  onChange,
  disabled,
  autoFocus,
  ...rest
}: SixDigitCodeFieldProps) {
  function handleChange(raw: string) {
    const cleaned = raw.replace(/\D/g, "").slice(0, length);
    onChange(cleaned);
  }

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-zinc-700">
          {label}
        </label>
      )}

      <input
        id={id}
        name={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        onChange={(e) => handleChange(e.currentTarget.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        className={`${authStyles.input} px-5 text-left text-[1.2rem] tracking-[0.38em] disabled:opacity-100`}
        {...rest}
      />
    </div>
  );
}
