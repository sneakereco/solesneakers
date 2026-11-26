import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";
import type { AnalyticsFact } from "./contract";
import { DATASET_IDS } from "../Configuration/dataset";

type AttemptPayload = Extract<AnalyticsFact, { kind: "payment_attempt" }>["payload"];
export type OperationalOutcome = AttemptPayload & {
  effectiveAt: string;
  orderId: string | null;
  receiptId?: string | null;
};
export type OperationalDependencies = {
  after(job: () => Promise<void>): void;
  publish(outcome: OperationalOutcome): Promise<void>;
  gap(category: "analytics_operational_outcome_unavailable"): void;
};

export function paymentAttemptId(commandKey: string) {
  // Stable UUIDv8 derived from the server-generated Square idempotency command.
  // The provider key itself is never an analytics identifier.
  const h = createHash("sha256")
    .update("sole-payment-attempt:" + commandKey)
    .digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "8" + h.slice(13, 16),
    "8" + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}
export function recordOperationalOutcome(
  input: OperationalOutcome,
  deps: OperationalDependencies,
): Promise<void> {
  try {
    deps.after(async () => {
      try {
        await deps.publish(input);
      } catch {
        deps.gap("analytics_operational_outcome_unavailable");
      }
    });
  } catch {
    deps.gap("analytics_operational_outcome_unavailable");
  }
  return Promise.resolve();
}

export function scheduleOperationalOutcome(input: OperationalOutcome) {
  const environment = process.env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT;
  if (environment !== "staging" && environment !== "production") return;
  void recordOperationalOutcome(input, {
    after,
    async publish(outcome) {
      const { error } = await createSupabaseAdminClient().rpc(
        "analytics_record_operational_outcome",
        {
          p_dataset_id: DATASET_IDS[environment],
          p_outcome: outcome,
        },
      );
      if (error) throw Error("Analytics outcome unavailable");
    },
    gap: (category) => logError(new Error(category), { layer: "api", event: category }),
  });
}
