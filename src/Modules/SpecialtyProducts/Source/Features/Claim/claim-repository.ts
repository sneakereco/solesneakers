import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import {
  attemptCredentialsSchema,
  claimDecisionSchema,
  claimReplySchema,
  validatedEligibilitySchema,
  type AttemptCredentials,
  type AwardCommand,
  type ClaimReply,
  type StoredAttempt,
} from "./claim-contract";
import { hashRecoverySecret } from "./normalize-identity";
import type { ClaimFailure } from "../RequestProtection/claim-telemetry";

export type ClaimRepositoryErrorCode =
  | "unauthorized"
  | "payload_conflict"
  | "temporary_unavailable";
export class ClaimRepositoryError extends Error {
  constructor(
    readonly code: ClaimRepositoryErrorCode,
    readonly reason: ClaimFailure = "database_unavailable",
  ) {
    super(
      code === "unauthorized"
        ? "This claim result cannot be accessed with these credentials."
        : code === "payload_conflict"
          ? "This attempt is already bound to different details."
          : "Claim processing is temporarily unavailable. Check your result again.",
    );
    this.name = "ClaimRepositoryError";
  }
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commandSchema = z
  .object({
    attemptId: z.string().uuid(),
    recoveryHash: digest,
    inputHash: digest,
    payloadHash: digest,
    eligibility: validatedEligibilitySchema,
  })
  .strict();
const storedAttemptSchema = z
  .object({
    inputHash: digest,
    payloadHash: digest,
    result: claimDecisionSchema,
    productId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
  })
  .strict();
function failure(error: { message?: string; code?: string }): ClaimRepositoryError {
  return new ClaimRepositoryError(
    error.message?.includes("specialty_attempt_unauthorized")
      ? "unauthorized"
      : error.message?.includes("specialty_payload_conflict")
        ? "payload_conflict"
        : "temporary_unavailable",
    error.code === "55P03"
      ? "lock_contention"
      : error.code === "57014"
        ? "database_timeout"
        : error.code === "PGRST003"
          ? "database_pool_timeout"
          : "database_unavailable",
  );
}
export class SpecialtyClaimRepository {
  constructor(private readonly client: AdminSupabaseClient) {}
  async findAttempt(credentials: AttemptCredentials): Promise<StoredAttempt | null> {
    try {
      const parsed = attemptCredentialsSchema.parse(credentials);
      const { data, error } = await this.client.rpc(
        "read_specialty_claim_result_with_context",
        {
          p_attempt_id: parsed.attemptId,
          p_recovery_hash: hashRecoverySecret(parsed.recoverySecret),
        },
      );
      if (error) throw failure(error);
      if (data === null) return null;
      const stored = storedAttemptSchema.safeParse(data);
      if (!stored.success) throw new ClaimRepositoryError("temporary_unavailable");
      return stored.data;
    } catch (error) {
      if (error instanceof ClaimRepositoryError) throw error;
      throw new ClaimRepositoryError("temporary_unavailable");
    }
  }
  async accept(command: AwardCommand): Promise<ClaimReply> {
    try {
      const parsed = commandSchema.parse(command);
      const { data, error } = await this.client.rpc("accept_specialty_claim", {
        p_command: parsed,
      });
      if (error) throw failure(error);
      const result = claimReplySchema.safeParse(data);
      if (!result.success) throw new ClaimRepositoryError("temporary_unavailable");
      return result.data;
    } catch (error) {
      if (error instanceof ClaimRepositoryError) throw error;
      throw new ClaimRepositoryError("temporary_unavailable");
    }
  }
}
