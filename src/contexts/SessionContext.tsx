"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { SESSION_UPDATE, SESSION_REVALIDATING } from "@/lib/auth/session-events";
import { isProfileRole, type ProfileRole } from "@/config/constants/roles";
import { readJsonResponse } from "@/lib/http/read-json-response";
import { withRequestDeadline } from "@/lib/http/request-deadline";

interface SessionUser {
  id: string;
  email: string;
}

interface SessionContextValue {
  user: SessionUser | null;
  role: ProfileRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionRevision: number;
  sessionAvailable: boolean;
  isSessionUnavailable: boolean;
  hasRefreshed: boolean;
  refreshSession: () => Promise<void>;
  isIdentityCurrent: (expectedOwner: string | null) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

type SessionIdentity = { user: SessionUser | null; role: ProfileRole | null };

function parseIdentity(value: unknown): SessionIdentity {
  if (!value || typeof value !== "object" || !("user" in value) || !("role" in value)) {
    throw new Error("Invalid session response");
  }

  const { user, role } = value;
  if (user === null && role === null) return { user, role };
  if (
    user &&
    typeof user === "object" &&
    "id" in user &&
    typeof user.id === "string" &&
    user.id &&
    "email" in user &&
    typeof user.email === "string" &&
    isProfileRole(role)
  ) {
    return { user: { id: user.id, email: user.email }, role };
  }

  throw new Error("Invalid session identity");
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
  const [serverSeed, setServerSeed] = useState({
    readId: serverReadId,
    user: initialUser,
    role: initialRole,
    unavailable: initialUnavailable,
  });
  const [identity, setIdentity] = useState<SessionIdentity>({
    user: initialUser,
    role: initialRole,
  });
  const { user, role } = identity;
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionUnavailable, setSessionUnavailable] = useState(initialUnavailable);
  const [hasRefreshed, setHasRefreshed] = useState(false);
  const active = useRef<AbortController | null>(null);

  const [sessionRevision, setSessionRevision] = useState(0);
  const verifiedOwner = useRef<string | null | undefined>(
    initialUnavailable ? undefined : (initialUser?.id ?? null),
  );
  const isIdentityCurrent = useCallback(
    (expectedOwner: string | null) =>
      active.current === null && verifiedOwner.current === expectedOwner,
    [],
  );
  useLayoutEffect(() => {
    verifiedOwner.current =
      isLoading || isSessionUnavailable ? undefined : (identity.user?.id ?? null);
    return () => {
      verifiedOwner.current = undefined;
    };
  }, [identity, isLoading, isSessionUnavailable, serverSeed]);

  if (
    serverSeed.readId !== serverReadId ||
    serverSeed.user?.id !== initialUser?.id ||
    serverSeed.user?.email !== initialUser?.email ||
    serverSeed.role !== initialRole ||
    serverSeed.unavailable !== initialUnavailable
  ) {
    setSessionRevision((revision) => revision + 1);
    setServerSeed({
      readId: serverReadId,
      user: initialUser,
      role: initialRole,
      unavailable: initialUnavailable,
    });
    setIsLoading(false);
    setSessionUnavailable(initialUnavailable);
    if (!initialUnavailable) {
      setIdentity({ user: initialUser, role: initialRole });
      setHasRefreshed(true);
    }
  }

  useLayoutEffect(() => {
    // A newly committed server read supersedes any older client refresh.
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [serverSeed]);

  const refreshSession = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    verifiedOwner.current = undefined;
    window.dispatchEvent(new Event(SESSION_REVALIDATING));
    setIsLoading(true);
    try {
      const data = await withRequestDeadline(async (signal) => {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal });
        return readJsonResponse<unknown>(response, "Could not load account");
      }, controller.signal);
      if (active.current === controller) {
        setIdentity(parseIdentity(data));
        setHasRefreshed(true);
        setSessionUnavailable(false);
      }
    } catch {
      if (active.current === controller) setSessionUnavailable(true);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setIsLoading(false);
        setSessionRevision((revision) => revision + 1);
      }
    }
  }, []);

  // Listen for session update events (triggered by login/logout)
  useEffect(() => {
    const channelName = "sole-auth-session-changed";
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(channelName);
    } catch {
      /* Storage events support older browsers. */
    }
    const refresh = () => {
      void refreshSession();
    };
    if (channel) channel.onmessage = refresh;
    const stored = (event: StorageEvent) => {
      if (event.key === channelName && event.newValue === "changed") refresh();
    };
    const changed = () => {
      refresh();
      if (channel) {
        channel.postMessage("changed");
      } else {
        try {
          window.localStorage.setItem(channelName, "changed");
          window.localStorage.removeItem(channelName);
        } catch {
          /* Refresh again on resumption. */
        }
      }
    };
    window.addEventListener(SESSION_UPDATE, changed);
    window.addEventListener("storage", stored);
    return () => {
      channel?.close();
      window.removeEventListener(SESSION_UPDATE, changed);
      window.removeEventListener("storage", stored);
    };
  }, [refreshSession]);

  return (
    <SessionContext.Provider
      value={{
        user,
        role,
        isAuthenticated: Boolean(user),
        isLoading,
        isSessionUnavailable,
        hasRefreshed,
        refreshSession,
        sessionAvailable: !isSessionUnavailable,
        sessionRevision,
        isIdentityCurrent,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return context;
}
