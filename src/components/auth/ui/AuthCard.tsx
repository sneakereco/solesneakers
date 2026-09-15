// app/auth/components/AuthCard.tsx
import type { ReactNode } from "react";

interface AuthCardProps {
  children: ReactNode;
  className?: string;
}

export default function AuthCard({ children, className = "" }: AuthCardProps) {
  return (
    <div
      className={
        "w-full max-w-md rounded-2xl border border-neutral-200/60 bg-white/95 px-6 py-7 shadow-xl transition-all dark:border-neutral-800/80 dark:bg-neutral-900/95 sm:px-8 sm:py-8 " +
        className
      }
    >
      {children}
    </div>
  );
}
