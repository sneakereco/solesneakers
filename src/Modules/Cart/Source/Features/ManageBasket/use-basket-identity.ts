"use client";
import { useSession } from "@/contexts/SessionContext";
export function useBasketIdentity() {
  const { user, status, isCurrent, refreshSession } = useSession();
  return {
    userId: status === "ready" ? (user?.id ?? null) : undefined,
    access: status,
    isCurrent,
    retry: refreshSession,
  };
}
