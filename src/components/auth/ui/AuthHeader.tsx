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
      <h1 className="text-[1.75rem] font-normal uppercase tracking-[0.015em] text-zinc-900 sm:text-[min(1.46vw,1.75rem)]">
        {title}
      </h1>
      {description && (
        <p className="mx-auto mt-[min(1.06vw,1.25rem)] max-w-[31rem] text-[1rem] leading-[min(1.46vw,1.75rem)] text-zinc-800">
          {description}
        </p>
      )}
    </div>
  );
}
