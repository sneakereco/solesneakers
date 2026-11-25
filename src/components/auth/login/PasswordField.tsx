// src/components/auth/login/PasswordField.tsx
"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { authStyles } from "@/components/auth/ui/authStyles";
import { ActionButton } from "@/components/ui/ActionButton";

interface PasswordFieldProps {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  dataTestId?: string;
  disabled?: boolean;
  describedBy?: string;
}

export function PasswordField({
  name,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  required = true,
  dataTestId,
  disabled = false,
  describedBy,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <label htmlFor={name} className={authStyles.label}>
        {label}
      </label>
      <div className="relative">
        <input
          id={name}
          name={name}
          type={visible ? "text" : "password"}
          required={required}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={disabled}
          className={`${authStyles.input} pr-14`}
          placeholder={placeholder}
          data-testid={dataTestId}
          aria-describedby={describedBy}
        />
        <ActionButton
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-800"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-controls={name}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </ActionButton>
      </div>
    </div>
  );
}
