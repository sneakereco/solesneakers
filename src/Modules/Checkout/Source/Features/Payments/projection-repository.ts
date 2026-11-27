import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import {
  financialFact,
  financialSnapshot,
  type VerifiedFinancialFact,
} from "./payment-facts";

// Construct only after the authenticated provider inquiry. The RPC separately
// checks the immutable ledger quote and the already bound payment identity.
export class FinancialProjectionRepository {
  constructor(
    private readonly client: Pick<AdminSupabaseClient, "rpc">,
    private readonly observedAt: string,
    private readonly reviewReason: "square_payment_high_risk" | null = null,
  ) {}
  async recordTerminalCapture(
    attemptId: string,
    squareOrderId: string,
    referenceId: string,
    method: string,
    value: VerifiedFinancialFact,
  ) {
    const fact = financialFact.parse(value);
    const { data, error } = await this.client.rpc("record_checkout_terminal_capture", {
      p_attempt_id: attemptId,
      p_square_order_id: squareOrderId,
      p_reference_id: referenceId,
      p_method: method,
      p_fact: fact,
      p_provider_time: this.observedAt,
    });
    if (error) throw error;
    return financialSnapshot.parse(data);
  }

  async applyFinancialFact(value: VerifiedFinancialFact) {
    const fact = financialFact.parse(value);
    const { data, error } = await this.client.rpc("apply_checkout_financial_fact", {
      p_fact: fact,
      p_provider_time: this.observedAt,
      ...(this.reviewReason ? { p_review: this.reviewReason } : {}),
    });
    if (error) throw error;
    return financialSnapshot.parse(data);
  }
}
