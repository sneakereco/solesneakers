// src/lib/auth/session.ts
import { isRejectedSessionError } from "./rejected-session";
export { isRejectedSessionError } from "./rejected-session";
import { redirect } from "next/navigation";
import { isDynamicServerError } from "next/dist/client/components/hooks-server-context";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileRepository } from "@/repositories/profile-repo";
import type { ProfileRole } from "@/config/constants/roles";
import { isAdminRole, isProfileRole } from "@/config/constants/roles";
import { withRequestDeadline } from "@/lib/http/request-deadline";
import { logError } from "@/lib/utils/log";

export interface ServerSession {
  user: {
    id: string;
    email: string;
  };
  profile: {
    id: string;
    email: string;
    role: ProfileRole;
    full_name: string | null;
    tenant_id: string | null;
  } | null;
  role: ProfileRole;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Read the validated session for callers that can represent temporary unavailability. */
export async function readServerSession(): Promise<ServerSession | null> {
  return withRequestDeadline(readVerifiedSession);
}

async function readVerifiedSession(signal: AbortSignal): Promise<ServerSession | null> {
  const supabase = await createSupabaseServerClient(signal);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    if (isRejectedSessionError(error)) return null;
    throw error;
  }
  if (!user) return null;

  if (signal.aborted) throw signal.reason;
  const profileRepo = new ProfileRepository(supabase);
  const row = await profileRepo.getByUserId(user.id);
  const profile = row
    ? {
        id: row.id,
        email: row.email ?? user.email ?? "",
        role: isProfileRole(row.role) ? row.role : ("customer" as const),
        full_name: row.full_name ?? null,
        tenant_id: row.tenant_id ?? null,
      }
    : null;

  return {
    user: { id: user.id, email: user.email ?? "" },
    profile,
    role: profile?.role ?? "customer",
  };
}

export async function getServerSession(): Promise<ServerSession | null> {
  try {
    return await readServerSession();
  } catch (error) {
    if (!isDynamicServerError(error)) {
      logError(error, {
        layer: "auth",
        route: "getServerSession",
        message: "server_session_lookup_failed",
      });
    }
    return null;
  }
}

/**
 * PAGE GUARDS (Server Components / Pages)
 * These keep your current behavior (redirects).
 */
export async function requireUser(): Promise<ServerSession> {
  const session = await getServerSession();
  if (!session) {
    redirect("/auth/login");
  }
  return session;
}

export async function requireAdmin(): Promise<ServerSession> {
  const session = await requireUser();
  if (!isAdminRole(session.role)) {
    redirect("/");
  }
  return session;
}

/**
 * API GUARDS (Route Handlers)
 * Never redirect inside API routes; throw typed errors with status instead.
 */
export async function requireUserApi(): Promise<ServerSession> {
  const session = await getServerSession();
  if (!session) {
    throw new AuthError("Unauthorized", 401);
  }
  return session;
}

export async function requireAdminApi(): Promise<ServerSession> {
  const session = await requireUserApi();
  if (!isAdminRole(session.role)) {
    throw new AuthError("Forbidden", 403);
  }
  return session;
}
