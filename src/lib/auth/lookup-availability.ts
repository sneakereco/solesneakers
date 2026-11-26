import { isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";

// Only an authoritative absence or rejection can establish a guest session.
export function requireAuthLookupAvailable(error: AuthError | null): void {
  if (!error || isAuthSessionMissingError(error)) return;
  if (
    [400, 401, 403, 404].includes(error.status ?? 0) &&
    [
      "bad_jwt",
      "user_not_found",
      "user_banned",
      "session_not_found",
      "session_expired",
      "refresh_token_not_found",
      "refresh_token_already_used",
    ].includes(error.code ?? "")
  )
    return;
  throw new Error("Authentication lookup unavailable");
}
