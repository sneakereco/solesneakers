import { z } from "zod";
import { log } from "@/lib/utils/log";
export type ClaimMetric = {
  requestId: string;
  productId?: string;
  campaignId?: string;
  outcome: string;
  durationMs: number;
};
const metricSchema = z.object({
  requestId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  outcome: z.enum([
    "won",
    "sold_out",
    "already_claimed",
    "closed",
    "pending",
    "invalid",
    "validation_required",
    "unavailable",
    "forbidden",
    "payload_conflict",
    "throttled",
  ]),
  durationMs: z.number().finite().nonnegative(),
});
export function recordClaimMetric(metric: ClaimMetric): void {
  // Parsing strips any accidental extra fields. Never attach errors or request payloads.
  const parsed = metricSchema.safeParse(metric);
  if (!parsed.success) return;
  log({
    level: "info",
    layer: "api",
    message: "specialty_claim_decision",
    ...parsed.data,
  });
}
