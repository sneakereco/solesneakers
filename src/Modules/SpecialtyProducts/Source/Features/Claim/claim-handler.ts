import { randomUUID } from "node:crypto";
import type { EligibilityDependencies } from "../ValidateEligibility/validate-eligibility-handler";
import type { ClaimMetric } from "../RequestProtection/claim-telemetry";
import {
  attemptCredentialsSchema,
  claimSubmissionSchema,
  type AttemptCredentials,
  type StoredAttempt,
  type AwardCommand,
  type ClaimReply,
  type ValidatedEligibility,
} from "./claim-contract";
import {
  canonicalAddressIdentity,
  deriveEligibilityKeys,
  fingerprintInput,
  fingerprintSubmission,
  getIdentityKeyFingerprint,
  hashRecoverySecret,
  normalizeInstagramHandle,
} from "./normalize-identity";
import { verifyEligibilityToken } from "./validation-token";
import { ClaimRepositoryError } from "./claim-repository";
import { ClaimBodyError, privateClaimReply as reply, readClaimJson } from "./claim-http";

export type ClaimDependencies = EligibilityDependencies & {
  findAttempt(credentials: AttemptCredentials): Promise<StoredAttempt | null>;
  accept(command: AwardCommand): Promise<ClaimReply>;
  recordMetric(event: ClaimMetric): void;
};
const unavailable = () => reply({ status: "unavailable", retryAfterSeconds: 1 }, 503, 1);
function failure(error: unknown): Response {
  if (error instanceof ClaimBodyError) return reply({ status: "invalid" }, error.status);
  if (error instanceof ClaimRepositoryError && error.code === "unauthorized")
    return reply({ status: "forbidden" }, 403);
  if (error instanceof ClaimRepositoryError && error.code === "payload_conflict")
    return reply({ status: "payload_conflict" }, 409);
  return unavailable();
}
async function protectedReply(
  request: Request,
  deps: ClaimDependencies,
  operation: "recover" | "submit",
  browserId = "",
): Promise<Response | null> {
  const decision = await deps.protect(request, operation, browserId);
  return decision.allowed
    ? null
    : reply(
        {
          status:
            decision.status === 429
              ? "throttled"
              : decision.status === 403
                ? "forbidden"
                : "unavailable",
          retryAfterSeconds: decision.retryAfterSeconds ?? 1,
        },
        decision.status,
        decision.retryAfterSeconds ?? 1,
      );
}
async function withMetric(
  deps: ClaimDependencies,
  work: () => Promise<Response>,
): Promise<Response> {
  const requestId = randomUUID(),
    started = deps.nowMs();
  let response: Response;
  try {
    response = await work();
  } catch (error) {
    response = failure(error);
  }
  try {
    const data = await response.clone().json();
    deps.recordMetric({
      requestId,
      outcome: data.result?.status ?? data.status ?? "unavailable",
      durationMs: Math.max(0, deps.nowMs() - started),
    });
  } catch {
    /* Telemetry must never affect the decision or expose request data. */
  }
  return response;
}
export async function recoverClaimHandler(
  request: Request,
  deps: ClaimDependencies,
): Promise<Response> {
  return withMetric(deps, async () => {
    const blocked = await protectedReply(request, deps, "recover");
    if (blocked) return blocked;
    const credentials = attemptCredentialsSchema.safeParse(await readClaimJson(request));
    if (!credentials.success) return reply({ status: "invalid" }, 422);
    const stored = await deps.findAttempt(credentials.data);
    return stored
      ? reply({ result: stored.result, replayed: true })
      : reply({ status: "pending", retryAfterSeconds: 1 }, 202, 1);
  });
}
export async function submitClaimHandler(
  request: Request,
  deps: ClaimDependencies,
): Promise<Response> {
  return withMetric(deps, async () => {
    // Replays have recovery-level protection and never depend on a live bot/address provider.
    const blockedRead = await protectedReply(request, deps, "recover");
    if (blockedRead) return blockedRead;
    const parsed = claimSubmissionSchema.safeParse(await readClaimJson(request));
    if (!parsed.success) return reply({ status: "invalid" }, 422);
    const input = parsed.data;
    const credentials = {
      attemptId: input.attemptId,
      recoverySecret: input.recoverySecret,
    };
    const stored = await deps.findAttempt(credentials);
    const secret = deps.secret();
    if (!secret) return unavailable();
    let inputHash: string, handle: string;
    try {
      inputHash = fingerprintInput(input, secret);
      handle = normalizeInstagramHandle(input.instagramHandle);
    } catch {
      return reply({ status: "invalid" }, 422);
    }
    if (stored)
      return stored.inputHash === inputHash
        ? reply({ result: stored.result, replayed: true })
        : reply({ status: "payload_conflict" }, 409);
    const context = await deps.getContext(request, input.productId);
    if (!context || context.identityKeyFingerprint !== getIdentityKeyFingerprint(secret))
      return unavailable();
    const blocked = await protectedReply(request, deps, "submit", context.browserId);
    if (blocked) return blocked;
    let eligibility: ValidatedEligibility | null;
    if (input.validationToken) {
      eligibility = verifyEligibilityToken(
        input.validationToken,
        context,
        secret,
        deps.nowMs(),
      );
      if (
        !eligibility ||
        eligibility.instagramHandle !== handle ||
        canonicalAddressIdentity(eligibility.address) !==
          canonicalAddressIdentity(input.address)
      )
        return reply({ status: "validation_required" }, 422);
    } else {
      const validation = await deps.validateAddress(input.address);
      if (validation.status === "unavailable") return unavailable();
      if (validation.status !== "valid")
        return reply({ status: "validation_required" }, 422);
      eligibility = {
        ...context,
        identityKeyFingerprint: context.identityKeyFingerprint,
        instagramHandle: handle,
        address: validation.address,
        ...deriveEligibilityKeys(context.campaignId, handle, validation.address, secret),
        expiresAt: deps.nowMs() + 600000,
      };
    }
    const result = await deps.accept({
      attemptId: input.attemptId,
      recoveryHash: hashRecoverySecret(input.recoverySecret),
      inputHash,
      payloadHash: fingerprintSubmission(input.productId, eligibility),
      eligibility,
    });
    return reply(result);
  });
}
