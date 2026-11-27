import { AuthError, readServerSession, requireUserApi } from "@/lib/auth/session";
import { logError } from "@/lib/utils/log";

import { accountOwnerHeader } from "./request";

export class AccountSessionError extends AuthError {}

export async function requireAccountSession(request: Request, kind: "read" | "write") {
  const expectedOwner = request.headers.get(accountOwnerHeader);
  if (kind === "write" && expectedOwner === null) return requireUserApi();

  let session;
  try {
    session = await readServerSession();
  } catch (error) {
    logError(error, { layer: "auth", message: "account_session_lookup_failed" });
    throw new AccountSessionError("Could not verify your account session", 503);
  }

  if (!session) throw new AccountSessionError("Unauthorized", 401);
  // The header is a request precondition. Authentication always supplies the owner.
  if (expectedOwner !== null && expectedOwner !== session.user.id) {
    throw new AccountSessionError("Account changed", 409);
  }
  return session;
}
