"use client";
import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { SESSION_REVALIDATING, SESSION_UPDATE } from "@/lib/auth/session-events";
import { isProfileRole, type ProfileRole } from "@/config/constants/roles";
import { withRequestDeadline } from "@/lib/http/request-deadline";
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
  isSessionUnavailable: boolean;
  hasRefreshed: boolean;
  sessionRevision: number;
  sessionMutationRevision: number;
  sessionAvailable: boolean;
  isIdentityCurrent: (expectedOwner: string | null) => boolean;
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
  initialUnavailable = false,
  serverReadId,
}: {
  children: React.ReactNode;
  initialUser: SessionUser | null;
  initialRole: ProfileRole | null;
  initialUnavailable?: boolean;
  serverReadId?: string;
}) {
  const [observation, setObservation] = useState<Observation>({
    ...masked,
    status: initialUnavailable ? "unavailable" : "checking",
    isCurrent: masked.isCurrent,
  });
  const [retryingUnavailable, setRetryingUnavailable] = useState(initialUnavailable);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [sessionMutationRevision, setSessionMutationRevision] = useState(0);
  const active = useRef<AbortController | null>(null);
  const generation = useRef<string | null>(null);
  const beginObservation = useCallback(() => {
    active.current?.abort();
    window.dispatchEvent(new Event(SESSION_REVALIDATING));
    setSessionRevision((revision) => revision + 1);
    const request = new AbortController();
    active.current = request;
    const atStart = readSessionGeneration();
    generation.current = atStart;
    const isCurrent = () => {
      if (request.signal.aborted) return false;
      if (readSessionGeneration() === atStart) return true;
      // A cooperating tab can publish a change before this renderer receives its storage event.
      window.dispatchEvent(new Event(SESSION_UPDATE));
      return false;
    };
    return { request, isCurrent };
  }, []);
  const refreshSession = useCallback(async () => {
    const { request, isCurrent } = beginObservation();
    setObservation({ ...masked, status: "checking" });
    try {
      const { facts, status } = await withRequestDeadline(async (signal) => {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal });
        const verified = response.ok ? parseSession(await response.json()) : undefined;
        return { facts: verified, status: response.status };
      }, request.signal);
      if (!isCurrent()) return;
      setRetryingUnavailable(!facts);
      setObservation(
        facts
          ? { ...facts, status: "ready", isCurrent }
          : { ...masked, status: status === 403 ? "denied" : "unavailable" },
      );
    } catch {
      if (isCurrent()) {
        setRetryingUnavailable(true);
        setObservation({ ...masked, status: "unavailable" });
      }
    }
  }, [beginObservation]);
  useEffect(() => {
    function verify() {
      void refreshSession();
    }
    function identityChanged() {
      setSessionMutationRevision((revision) => revision + 1);
      verify();
    }
    function onStorage(event: StorageEvent) {
      if (
        (event.key === sessionGenerationKey || event.key === null) &&
        readSessionGeneration() !== generation.current
      )
        identityChanged();
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
      channel.onmessage = identityChanged;
    } catch {
      /* Storage events remain available where supported. */
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(SESSION_UPDATE, identityChanged);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active.current?.abort();
      channel?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SESSION_UPDATE, identityChanged);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshSession]);
  useLayoutEffect(() => {
    if (!serverReadId) {
      let mounted = true;
      queueMicrotask(() => {
        if (mounted) void refreshSession();
      });
      return () => {
        mounted = false;
        active.current?.abort();
      };
    } else {
      // Apply the verified server observation synchronously before painting this scope.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      const { isCurrent } = beginObservation();
      const facts = initialUnavailable
        ? undefined
        : parseSession({ user: initialUser, role: initialRole });
      setRetryingUnavailable(!facts);
      setObservation(
        facts
          ? { ...facts, status: "ready", isCurrent }
          : { ...masked, status: "unavailable" },
      );
    }
    return () => active.current?.abort();
  }, [
    refreshSession,
    beginObservation,
    serverReadId,
    initialUser,
    initialRole,
    initialUnavailable,
  ]);
  return (
    <SessionContext.Provider
      value={{
        ...observation,
        isAuthenticated: observation.status === "ready" && Boolean(observation.user),
        isLoading: observation.status === "checking",
        isSessionUnavailable:
          retryingUnavailable ||
          observation.status === "denied" ||
          observation.status === "unavailable",
        sessionAvailable: observation.status === "ready",
        sessionRevision,
        sessionMutationRevision,
        hasRefreshed: observation.status === "ready",
        isIdentityCurrent: (expectedOwner) =>
          observation.status === "ready" &&
          observation.isCurrent() &&
          (observation.user?.id ?? null) === expectedOwner,
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
