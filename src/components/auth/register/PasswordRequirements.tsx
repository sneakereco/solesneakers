// src/components/auth/register/PasswordRequirements.tsx
"use client";

import { Check, X } from "lucide-react";

import { evaluatePasswordRequirements } from "@/lib/validation/password";

export function PasswordRequirements({ password }: { password: string }) {
  const req = evaluatePasswordRequirements(password);

  return (
    <div className="space-y-3 border border-zinc-300 bg-white px-5 py-4">
      <p className="text-[0.74rem] uppercase tracking-[0.2em] text-zinc-500">
        Password requirements
      </p>
      <div className="grid grid-cols-2 gap-2">
        <RequirementItem ok={req.minLength} text="8+ characters" />
        <RequirementItem ok={req.notRepeatedChar} text="Varied characters" />
      </div>
    </div>
  );
}

function RequirementItem({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-4 w-4 items-center justify-center ${
          ok ? "text-emerald-600" : "text-zinc-400"
        }`}
      >
        {ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
      </div>
      <span className={`text-[0.82rem] ${ok ? "text-zinc-700" : "text-zinc-500"}`}>
        {text}
      </span>
    </div>
  );
}
