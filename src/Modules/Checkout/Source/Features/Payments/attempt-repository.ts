import { log } from "@/lib/utils/log";
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

// A consumed permit can observe the latest sequence but can never create one.
export async function readCurrentPaymentAttempt(
  client: Pick<AdminSupabaseClient, "from">,
  orderId: string,
): Promise<PaymentAttempt | null> {
  const { data, error } = await client
    .from("checkout_payment_attempts")
    .select(
      "id,orderId:order_id,sequence,state,method,amountCents:amount_cents,currency,squareIdempotencyKey:square_idempotency_key,requestDigest:request_digest,providerPaymentId:provider_payment_id",
    )
    .eq("order_id", orderId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  const row = paymentAttemptSchema.safeParse(data);
  if (!row.success || row.data.orderId !== orderId)
    throw new Error("Invalid checkout attempt response");
  return row.data;
}

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
    log({
      level: "info",
      layer: "repository",
      message: "checkout_attempt",
      orderId,
      attemptId: row.data.id,
      state: row.data.state,
      outcome: "observed",
    });
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
    log({
      level: "info",
      layer: "repository",
      message: "checkout_attempt",
      orderId: decision.data.attempt.orderId,
      attemptId,
      state: decision.data.attempt.state,
      outcome: decision.data.kind,
    });
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
    const retained =
      verifiedFacts.kind === "uncertain" &&
      state === "unknown" &&
      row.success &&
      ["pending", "review"].includes(row.data.state);
    if (
      !row.success ||
      row.data.id !== attemptId ||
      (!retained && row.data.state !== state) ||
      (verifiedFacts.kind !== "uncertain" &&
        row.data.providerPaymentId !== providerPaymentId) ||
      (verifiedFacts.kind === "square_payment" &&
        (row.data.orderId !== verifiedFacts.orderId ||
          row.data.amountCents !== verifiedFacts.amountCents ||
          row.data.providerPaymentId !== verifiedFacts.paymentId)) ||
      (verifiedFacts.kind === "square_decline" &&
        row.data.requestDigest !== verifiedFacts.requestDigest)
    )
      throw new Error("Invalid checkout outcome response");
    log({
      level: "info",
      layer: "repository",
      message: "checkout_attempt",
      orderId: row.data.orderId,
      attemptId,
      state: row.data.state,
    });
    return row.data;
  }
}
