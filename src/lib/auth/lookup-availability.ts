import { isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";
import { isRejectedSessionError } from "./rejected-session";

// A provider outage cannot establish a guest session, even with a token error code.
export function isDefinitiveAuthRejection(error: AuthError): boolean {
  return (
    isAuthSessionMissingError(error) ||
    ([400, 401, 403, 404].includes(error.status ?? 0) && isRejectedSessionError(error))
  );
}

export function requireAuthLookupAvailable(error: AuthError | null): void {
  if (error && !isDefinitiveAuthRejection(error))
    throw new Error("Authentication lookup unavailable");
}
