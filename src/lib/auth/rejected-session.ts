import {
  isAuthSessionMissingError,
  type AuthError as SupabaseAuthError,
} from "@supabase/supabase-js";

const rejectedSessionCodes = new Set([
  "bad_jwt",
  "no_authorization",
  "user_not_found",
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "user_banned",
]);

export function isRejectedSessionError(error: SupabaseAuthError) {
  return (
    isAuthSessionMissingError(error) ||
    Boolean(error.code && rejectedSessionCodes.has(error.code))
  );
}
