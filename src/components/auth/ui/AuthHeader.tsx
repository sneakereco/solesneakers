// src/components/auth/ui/AuthHeader.tsx
"use client";

export function AuthHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="text-center">
      <h1 className="text-[1.75rem] font-normal uppercase tracking-[0.015em] text-zinc-900">
        {title}
      </h1>
      {description && (
        <p className="mx-auto mt-3 max-w-[31rem] text-base leading-relaxed text-zinc-800">
          {description}
        </p>
      )}
    </div>
  );
}
