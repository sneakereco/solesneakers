import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import {
  recoveryJobSchema,
  validateRecoveryReason,
  type ClaimRecoveryInput,
  type FinishRecoveryInput,
  type RecoveryInput,
  type RecoveryJob,
} from "./recovery-contract";

const claimSchema = z.array(recoveryJobSchema).max(50);

export class CheckoutRecoveryRepository {
  constructor(private readonly client: Pick<AdminSupabaseClient, "rpc">) {}

  async enqueueRecovery(input: RecoveryInput): Promise<void> {
    const { error } = await this.client.rpc("enqueue_checkout_recovery", {
      p_kind: input.kind,
      p_unique_key: input.uniqueKey,
      p_due_at: input.dueAt,
      p_reason: validateRecoveryReason(input.reason),
      ...(input.kind === "square_event"
        ? { p_event_id: input.eventId }
        : { p_order_id: input.orderId }),
    });
    if (error) throw error;
  }

  async claimRecovery(input: ClaimRecoveryInput): Promise<RecoveryJob[]> {
    const { data, error } = await this.client.rpc("claim_checkout_recovery", {
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
      p_now: input.now,
    });
    if (error) throw error;
    const claim = claimSchema.safeParse(data);
    if (!claim.success) throw new Error("Invalid checkout recovery claim");
    return claim.data;
  }

  async finishRecovery(input: FinishRecoveryInput): Promise<boolean> {
    const { data, error } = await this.client.rpc("finish_checkout_recovery", {
      p_id: input.id,
      p_lease_token: input.leaseToken,
      p_result: input.result,
      p_next_attempt_at: input.nextAttemptAt,
      p_reason: validateRecoveryReason(input.reason),
    });
    if (error) throw error;
    if (typeof data !== "boolean")
      throw new Error("Invalid checkout recovery completion");
    return data;
  }
}
