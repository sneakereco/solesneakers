import { isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";

// Only an authoritative absence or rejection can establish a guest session.
export function requireAuthLookupAvailable(error: AuthError | null): void {
  if (!error || isAuthSessionMissingError(error)) return;
  if (error.status === 401 || error.status === 403) return;
  if (
    error.status === 400 &&
    [
      "bad_jwt",
      "user_not_found",
      "session_not_found",
      "session_expired",
      "refresh_token_not_found",
      "refresh_token_already_used",
    ].includes(error.code ?? "")
  )
    return;
  throw new Error("Authentication lookup unavailable");
}
