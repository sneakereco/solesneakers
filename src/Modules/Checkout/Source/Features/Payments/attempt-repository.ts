import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import {
  beginDispatchSchema,
  dispatchDecisionSchema,
  getAttemptSchema,
  paymentAttemptSchema,
  recordOutcomeSchema,
  type BeginDispatchInput,
  type DispatchDecision,
  type GetAttemptInput,
  type PaymentAttempt,
  type RecordOutcomeInput,
} from "./attempt-contract";

export class CheckoutPaymentAttemptRepository {
  constructor(private readonly client: Pick<AdminSupabaseClient, "rpc">) {}

  async getOrCreateAttempt(input: GetAttemptInput): Promise<PaymentAttempt> {
    const args = getAttemptSchema.safeParse(input);
    if (!args.success) throw new Error("Invalid checkout attempt request");
    const { orderId, method, ownerBinding } = args.data;
    const { data, error } = await this.client.rpc(
      "get_or_create_checkout_payment_attempt",
      { p_order_id: orderId, p_method: method, p_owner_binding: ownerBinding },
    );
    if (error) throw error;
    const row = paymentAttemptSchema.safeParse(data);
    if (
      !row.success ||
      row.data.orderId !== orderId ||
      (row.data.state === "ready" && row.data.method !== method)
    )
      throw new Error("Invalid checkout attempt response");
    return row.data;
  }

  async beginDispatch(input: BeginDispatchInput): Promise<DispatchDecision> {
    const args = beginDispatchSchema.safeParse(input);
    if (!args.success) throw new Error("Invalid checkout dispatch request");
    const { attemptId, ownerBinding, requestDigest, sourceDigest } = args.data;
    const { data, error } = await this.client.rpc("begin_checkout_payment_dispatch", {
      p_attempt_id: attemptId,
      p_owner_binding: ownerBinding,
      p_request_digest: requestDigest,
      p_source_digest: sourceDigest,
    });
    if (error) throw error;
    const decision = dispatchDecisionSchema.safeParse(data);
    if (
      !decision.success ||
      decision.data.attempt.id !== attemptId ||
      (decision.data.kind === "dispatch" &&
        decision.data.attempt.requestDigest !== requestDigest)
    )
      throw new Error("Invalid checkout dispatch decision");
    return decision.data;
  }

  async recordAttemptOutcome(input: RecordOutcomeInput): Promise<PaymentAttempt> {
    const args = recordOutcomeSchema.safeParse(input);
    if (!args.success) throw new Error("Invalid checkout outcome request");
    const { attemptId, state, providerPaymentId, verifiedFacts } = args.data;
    const { data, error } = await this.client.rpc("record_checkout_payment_outcome", {
      p_attempt_id: attemptId,
      p_state: state,
      ...(providerPaymentId === null ? {} : { p_provider_payment_id: providerPaymentId }),
      p_verified_facts: verifiedFacts,
    });
    if (error) throw error;
    const row = paymentAttemptSchema.safeParse(data);
    if (!row.success || row.data.id !== attemptId)
      throw new Error("Invalid checkout outcome response");
    return row.data;
  }
}
