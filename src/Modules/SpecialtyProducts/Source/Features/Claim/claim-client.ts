import { z } from "zod";
import {
  claimReplySchema,
  eligibilityAddressSchema,
  type AttemptCredentials,
  type ClaimReply,
  type ClaimSubmission,
  type EligibilityRequest,
  type ValidationReply,
} from "./claim-contract";
export type UnknownClaim = { status: "unknown"; retryAfterSeconds: number };
export class ClaimClientError extends Error {
  constructor(
    readonly code:
      | "unavailable"
      | "throttled"
      | "forbidden"
      | "validation_required"
      | "payload_conflict"
      | "invalid",
    readonly retryAfterSeconds = 1,
  ) {
    super("Your claim result could not be confirmed. Check the same attempt again.");
  }
}
const validationSchema = z.union([
  z
    .object({
      status: z.literal("valid"),
      address: eligibilityAddressSchema,
      validationToken: z.string(),
      expiresAt: z.number(),
    })
    .strict(),
  z
    .object({
      status: z.literal("correction_required"),
      address: eligibilityAddressSchema,
      correctionToken: z.string(),
    })
    .strict(),
  z
    .object({ status: z.literal("invalid"), fields: z.record(z.string(), z.string()) })
    .strict(),
  z.object({ status: z.literal("unavailable"), retryAfterSeconds: z.number() }).strict(),
]);
async function post(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  allowValidationError = false,
): Promise<{ response: Response; data: unknown; retry: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    const data = await response.json().catch(() => null);
    const retry = Math.min(
      3600,
      Math.max(1, Number(response.headers.get("Retry-After")) || 1),
    );
    if (!response.ok && !(allowValidationError && response.status === 422)) {
      const status = (data as { status?: string } | null)?.status;
      throw new ClaimClientError(
        response.status === 429
          ? "throttled"
          : response.status === 403
            ? "forbidden"
            : response.status === 409
              ? "payload_conflict"
              : status === "validation_required"
                ? "validation_required"
                : response.status === 422 || response.status === 413
                  ? "invalid"
                  : "unavailable",
        retry,
      );
    }
    return { response, data, retry };
  } catch (error) {
    if (error instanceof ClaimClientError) throw error;
    throw new ClaimClientError("unavailable");
  } finally {
    clearTimeout(timeout);
  }
}
export async function validateClaimEligibility(
  input: EligibilityRequest,
): Promise<ValidationReply> {
  const { data, response } = await post(
    "/api/specialty/eligibility",
    input,
    undefined,
    true,
  );
  const parsed = validationSchema.safeParse(data);
  if (!parsed.success) throw new ClaimClientError("unavailable");
  if (response.status === 422 && parsed.data.status !== "invalid")
    throw new ClaimClientError("unavailable");
  return parsed.data;
}
export async function submitClaim(
  input: ClaimSubmission,
  signal?: AbortSignal,
): Promise<ClaimReply> {
  const { data } = await post("/api/specialty/claims", input, signal);
  const parsed = claimReplySchema.safeParse(data);
  if (!parsed.success) throw new ClaimClientError("unavailable");
  return parsed.data;
}
export async function recoverClaim(
  credentials: AttemptCredentials,
  signal?: AbortSignal,
): Promise<ClaimReply | UnknownClaim> {
  const { data, response, retry } = await post(
    "/api/specialty/claims/result",
    { attemptId: credentials.attemptId, recoverySecret: credentials.recoverySecret },
    signal,
  );
  if (response.status === 202) {
    const pending = z
      .object({
        status: z.literal("pending"),
        retryAfterSeconds: z.number().positive().max(3600),
      })
      .safeParse(data);
    if (!pending.success) throw new ClaimClientError("unavailable");
    return {
      status: "unknown",
      retryAfterSeconds: Math.max(retry, pending.data.retryAfterSeconds),
    };
  }
  const parsed = claimReplySchema.safeParse(data);
  if (!parsed.success) throw new ClaimClientError("unavailable");
  return parsed.data;
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (signal.aborted) done();
    else signal.addEventListener("abort", done, { once: true });
  });
}
export async function settleClaimAttempt(
  credentials: AttemptCredentials,
  input: ClaimSubmission | null,
  externalSignal?: AbortSignal,
): Promise<ClaimReply | UnknownClaim> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const signal = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal;
  let tries = 0,
    retryAfter = 0,
    fatal: ClaimClientError | null = null;
  const remember = (error: unknown) => {
    if (!(error instanceof ClaimClientError)) {
      retryAfter = 1;
      return;
    }
    retryAfter = error.retryAfterSeconds;
    if (!["throttled", "unavailable"].includes(error.code)) fatal = error;
  };
  try {
    if (input) {
      try {
        return await submitClaim(input, signal);
      } catch (error) {
        remember(error);
      }
    }
    while (!signal.aborted) {
      try {
        const result = await recoverClaim(credentials, signal);
        if ("result" in result) return result;
        retryAfter = Math.max(retryAfter, result.retryAfterSeconds);
      } catch (error) {
        remember(error);
      }
      if (fatal) throw fatal;
      if (signal.aborted) break;
      await pause(
        Math.max(
          retryAfter * 1000,
          Math.min(2000, 250 * 2 ** Math.min(tries++, 4)) * (0.75 + Math.random() * 0.25),
        ),
        signal,
      );
      if (input && !signal.aborted) {
        try {
          return await submitClaim(input, signal);
        } catch (error) {
          remember(error);
        }
      }
    }
    return { status: "unknown", retryAfterSeconds: 1 };
  } finally {
    clearTimeout(timer);
  }
}
