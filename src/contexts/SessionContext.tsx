"use client";
import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { isProfileRole, type ProfileRole } from "@/config/constants/roles";
import { readSessionGeneration, sessionGenerationKey } from "./session-change";

interface SessionUser {
  id: string;
  email: string;
}
type SessionFacts = { user: SessionUser | null; role: ProfileRole | null };
type Observation = SessionFacts & {
  status: "ready" | "checking" | "denied" | "unavailable";
  isCurrent: () => boolean;
};
type SessionContextValue = Observation & {
  isAuthenticated: boolean;
  isLoading: boolean;
  refreshSession: () => Promise<void>;
};
const SessionContext = createContext<SessionContextValue | null>(null);
const masked = { user: null, role: null, isCurrent: () => false };
function parseSession(value: unknown): SessionFacts | undefined {
  if (!value || typeof value !== "object" || !("user" in value) || !("role" in value))
    return;
  const { user, role } = value;
  if (user === null && role === null) return { user: null, role: null };
  if (
    user &&
    typeof user === "object" &&
    "id" in user &&
    typeof user.id === "string" &&
    user.id.trim() &&
    "email" in user &&
    typeof user.email === "string" &&
    isProfileRole(role)
  )
    return { user: { id: user.id, email: user.email }, role };
}
export function SessionProvider({
  children,
  initialUser,
  initialRole,
}: {
  children: React.ReactNode;
  initialUser: SessionUser | null;
  initialRole: ProfileRole | null;
}) {
  const [observation, setObservation] = useState<Observation>({
    user: initialUser,
    role: initialRole,
    status: "checking",
    isCurrent: masked.isCurrent,
  });
  const active = useRef<AbortController | null>(null);
  const generation = useRef<string | null>(null);
  const refreshSession = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    const atStart = readSessionGeneration();
    generation.current = atStart;
    setObservation({ ...masked, status: "checking" });
    const isCurrent = () => {
      if (request.signal.aborted) return false;
      if (readSessionGeneration() === atStart) return true;
      // A cooperating tab can publish a change before this renderer receives its storage event.
      window.dispatchEvent(new Event("sessionUpdate"));
      return false;
    };
    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        signal: request.signal,
      });
      const facts = response.ok ? parseSession(await response.json()) : undefined;
      if (!isCurrent()) return;
      setObservation(
        facts
          ? { ...facts, status: "ready", isCurrent }
          : { ...masked, status: response.status === 403 ? "denied" : "unavailable" },
      );
    } catch {
      if (isCurrent()) setObservation({ ...masked, status: "unavailable" });
    }
  }, []);
  useEffect(() => {
    function verify() {
      void refreshSession();
    }
    function onStorage(event: StorageEvent) {
      if (
        (event.key === sessionGenerationKey || event.key === null) &&
        readSessionGeneration() !== generation.current
      )
        verify();
    }
    function onVisible() {
      if (document.visibilityState === "visible") verify();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) verify();
    }
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(sessionGenerationKey);
      channel.onmessage = verify;
    } catch {
      /* Storage events remain available where supported. */
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("sessionUpdate", verify);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    verify();
    return () => {
      active.current?.abort();
      channel?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sessionUpdate", verify);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshSession]);
  return (
    <SessionContext.Provider
      value={{
        ...observation,
        isAuthenticated: observation.status === "ready" && Boolean(observation.user),
        isLoading: observation.status === "checking",
        refreshSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw Error("useSession must be used within SessionProvider");
  return context;
}
