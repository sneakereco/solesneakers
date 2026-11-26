import { randomUUID } from "node:crypto";
import type { EligibilityDependencies } from "../ValidateEligibility/validate-eligibility-handler";
import type { ClaimMetric } from "../RequestProtection/claim-telemetry";
import { observeAddressValidation } from "../RequestProtection/validation-observation";
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
type Observation = Pick<
  ClaimMetric,
  "requestId" | "productId" | "campaignId" | "failure" | "guard" | "databaseDurationMs"
>;
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
  operation: "recover" | "submit" | "validate",
  browserId = "",
  observation?: Observation,
): Promise<Response | null> {
  let decision;
  try {
    decision = await deps.protect(request, operation, browserId);
  } catch (error) {
    if (observation) {
      observation.failure = "protection_unavailable";
      observation.guard = operation;
    }
    throw error;
  }
  if (!decision.allowed && observation) {
    observation.guard = operation;
    if (decision.status === 503) observation.failure = "protection_unavailable";
  }
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
  operation: "submit" | "recover",
  work: (observation: Observation) => Promise<Response>,
): Promise<Response> {
  const requestId = randomUUID(),
    started = deps.nowMs();
  let response: Response;
  const observation: Observation = { requestId };
  try {
    response = await work(observation);
  } catch (error) {
    if (error instanceof ClaimRepositoryError && error.code === "temporary_unavailable")
      observation.failure = error.reason;
    response = failure(error);
  }
  try {
    const data = await response.clone().json();
    deps.recordMetric({
      ...observation,
      operation,
      event: data.replayed
        ? "replay"
        : data.result?.status === "won"
          ? "award"
          : response.status >= 400
            ? "failure"
            : "decision",
      outcome: data.replayed
        ? "replayed"
        : (data.result?.status ?? data.status ?? "unavailable"),
      ...(data.result ? { decision: data.result.status } : {}),
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
  return withMetric(deps, "recover", async (observation) => {
    const blocked = await protectedReply(request, deps, "recover", "", observation);
    if (blocked) return blocked;
    const credentials = attemptCredentialsSchema.safeParse(await readClaimJson(request));
    if (!credentials.success) return reply({ status: "invalid" }, 422);
    const stored = await deps.findAttempt(credentials.data);
    if (stored) {
      observation.productId = stored.productId;
      observation.campaignId = stored.campaignId;
    }
    return stored
      ? reply({ result: stored.result, replayed: true })
      : reply({ status: "pending", retryAfterSeconds: 1 }, 202, 1);
  });
}
export async function submitClaimHandler(
  request: Request,
  deps: ClaimDependencies,
): Promise<Response> {
  return withMetric(deps, "submit", async (observation) => {
    // Replays have recovery-level protection and never depend on a live bot/address provider.
    const blockedRead = await protectedReply(request, deps, "recover", "", observation);
    if (blockedRead) return blockedRead;
    const parsed = claimSubmissionSchema.safeParse(await readClaimJson(request));
    if (!parsed.success) return reply({ status: "invalid" }, 422);
    const input = parsed.data;
    observation.productId = input.productId;
    const credentials = {
      attemptId: input.attemptId,
      recoverySecret: input.recoverySecret,
    };
    const stored = await deps.findAttempt(credentials);
    if (stored) observation.campaignId = stored.campaignId;
    const secret = deps.secret();
    if (!secret) {
      observation.failure = "identity_unavailable";
      return unavailable();
    }
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
    if (context) observation.campaignId = context.campaignId;
    if (
      !context ||
      context.identityKeyFingerprint !== getIdentityKeyFingerprint(secret)
    ) {
      observation.failure = "identity_unavailable";
      return unavailable();
    }
    const blocked = await protectedReply(
      request,
      deps,
      "submit",
      context.browserId,
      observation,
    );
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
      const providerBlocked = await protectedReply(
        request,
        deps,
        "validate",
        context.browserId,
        observation,
      );
      if (providerBlocked) return providerBlocked;
      let validation;
      try {
        validation = await observeAddressValidation(deps, input.address, observation);
      } catch (error) {
        observation.failure = "address_provider_unavailable";
        throw error;
      }
      if (validation.status === "unavailable") {
        observation.failure = "address_provider_unavailable";
        return unavailable();
      }
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
    const databaseStarted = deps.nowMs();
    let result: ClaimReply;
    try {
      result = await deps.accept({
        attemptId: input.attemptId,
        recoveryHash: hashRecoverySecret(input.recoverySecret),
        inputHash,
        payloadHash: fingerprintSubmission(input.productId, eligibility),
        eligibility,
      });
    } finally {
      observation.databaseDurationMs = Math.max(0, deps.nowMs() - databaseStarted);
    }
    return reply(result);
  });
}
