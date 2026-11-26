"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { SESSION_UPDATE, SESSION_REVALIDATING } from "@/lib/auth/session-events";
import type { ProfileRole } from "@/config/constants/roles";

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
  refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  initialUser,
  initialRole,
}: {
  children: React.ReactNode;
  initialUser: SessionUser | null;
  initialRole: ProfileRole | null;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [role, setRole] = useState<ProfileRole | null>(initialRole);
  const [isLoading, setIsLoading] = useState(false);

  const [sessionAvailable, setSessionAvailable] = useState(true);
  const [sessionRevision, setSessionRevision] = useState(0);
  const latest = useRef(0);
  const refreshSession = useCallback(async () => {
    const revision = ++latest.current;
    window.dispatchEvent(new Event(SESSION_REVALIDATING));
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (revision !== latest.current) return;
      if (!response.ok) {
        setSessionAvailable(false);
        setUser(null);
        setRole(null);
        return;
      }
      const data = await response.json();
      if (revision !== latest.current) return;
      setSessionAvailable(true);
      setUser(data.user ?? null);
      setRole(data.role ?? null);
    } catch {
      if (revision === latest.current) setSessionAvailable(false);
      // Keep the displayed account on a temporary network error.
    } finally {
      if (revision === latest.current) {
        setIsLoading(false);
        setSessionRevision(revision);
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
        refreshSession,
        sessionAvailable,
        sessionRevision,
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
