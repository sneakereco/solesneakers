import { z } from "zod";
import { log } from "@/lib/utils/log";
export type ClaimFailure =
  | "lock_contention"
  | "database_timeout"
  | "database_pool_timeout"
  | "database_unavailable"
  | "protection_unavailable"
  | "address_provider_unavailable"
  | "identity_unavailable";
export type ClaimMetric = z.input<typeof metricSchema>;
const metricSchema = z.object({
  requestId: z.string().uuid(),
  operation: z.enum(["submit", "recover", "validate"]),
  event: z.enum(["award", "replay", "decision", "validation", "failure"]),
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
    "replayed",
    "valid",
    "correction_required",
  ]),
  decision: z.enum(["won", "sold_out", "already_claimed", "closed"]).optional(),
  failure: z
    .enum([
      "lock_contention",
      "database_timeout",
      "database_pool_timeout",
      "database_unavailable",
      "protection_unavailable",
      "address_provider_unavailable",
      "identity_unavailable",
    ])
    .optional(),
  guard: z.enum(["submit", "recover", "validate"]).optional(),
  databaseDurationMs: z.number().finite().nonnegative().optional(),
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
