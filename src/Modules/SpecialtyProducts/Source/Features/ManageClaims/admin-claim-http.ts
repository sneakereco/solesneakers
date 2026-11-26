import { z } from "zod";
import { AuthError } from "@/lib/auth/session";
import { ClaimBodyError, privateClaimReply } from "../Claim/claim-http";
export function adminClaimFailure(error: unknown): Response {
  if (error instanceof AuthError)
    return privateClaimReply(
      { error: error.status === 401 ? "Unauthorized" : "Forbidden" },
      error.status,
    );
  if (error instanceof z.ZodError || error instanceof ClaimBodyError)
    return privateClaimReply(
      { error: "Check the claim details." },
      error instanceof ClaimBodyError ? error.status : 422,
    );
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return privateClaimReply(
    {
      error:
        code === "conflict"
          ? "This record changed. Refresh and try again."
          : code === "forbidden"
            ? "Forbidden"
            : "Specialty claims are temporarily unavailable.",
    },
    code === "conflict"
      ? 409
      : code === "forbidden"
        ? 403
        : code === "not_found"
          ? 404
          : 503,
  );
}
