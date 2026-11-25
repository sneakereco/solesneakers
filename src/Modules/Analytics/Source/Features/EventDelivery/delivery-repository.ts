import "server-only";
import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import {
  analyticsFactSchema,
  datasetIdSchema,
  type AnalyticsFact,
} from "../CommerceFacts/contract";
import type { CaptureResult } from "./posthog-capture";

export type DeliveryFailure = Exclude<CaptureResult, { status: "accepted" }>;
export type LeasedPublication = {
  id: string;
  leaseToken: string;
  leaseExpiresAt: string;
  attempt: number;
  environment: "staging" | "production";
  fact: AnalyticsFact;
};
const leased = z.strictObject({
  publication_id: z.uuid(),
  lease_token: z.uuid(),
  lease_expires_at: z.iso.datetime({ offset: true }),
  attempt: z.number().int().min(1).max(8),
  environment: z.enum(["staging", "production"]),
  fact: analyticsFactSchema,
});
const failureSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("configuration-failure"),
    reason: z.enum(["not-configured", "redirect", "unauthorized", "not-found"]),
  }),
  z.strictObject({
    status: z.literal("retryable"),
    reason: z.enum([
      "timeout",
      "network",
      "rate-limited",
      "provider-unavailable",
      "invalid-response",
    ]),
    retryAfterMs: z.number().int().min(0).max(3600000).optional(),
  }),
  z.strictObject({
    status: z.literal("permanent-failure"),
    reason: z.enum(["provider-rejected", "invalid-events"]),
  }),
]);
export function createDeliveryRepository(db: AdminSupabaseClient, datasetId: string) {
  const scope = datasetIdSchema.parse(datasetId);
  return {
    async claimPublications(
      limit: number,
      leaseSeconds: number,
    ): Promise<LeasedPublication[]> {
      const { data, error } = await db.rpc("analytics_claim_publications", {
        p_dataset_id: scope,
        p_limit: z.number().int().min(1).max(200).parse(limit),
        p_lease_seconds: z.number().int().min(1).max(300).parse(leaseSeconds),
      });
      if (error) throw new Error("Analytics publication claim failed");
      const rows = z.array(leased).parse(data);
      if (rows.some((row) => row.fact.datasetId !== scope))
        throw new Error("Unexpected analytics dataset in claim");
      return rows.map((row) => ({
        id: row.publication_id,
        leaseToken: row.lease_token,
        leaseExpiresAt: row.lease_expires_at,
        attempt: row.attempt,
        environment: row.environment,
        fact: row.fact,
      }));
    },
    async completePublication(id: string, leaseToken: string): Promise<boolean> {
      const { data, error } = await db.rpc("analytics_complete_publication", {
        p_dataset_id: scope,
        p_id: z.uuid().parse(id),
        p_lease_token: z.uuid().parse(leaseToken),
      });
      if (error) throw new Error("Analytics publication completion failed");
      return z.boolean().parse(data);
    },
    async failPublication(
      id: string,
      leaseToken: string,
      failure: DeliveryFailure,
    ): Promise<boolean> {
      const validated = failureSchema.parse(failure);
      const delay =
        validated.status === "configuration-failure"
          ? 3600
          : validated.status === "retryable"
            ? Math.ceil((validated.retryAfterMs ?? 0) / 1000)
            : 0;
      const { data, error } = await db.rpc("analytics_fail_publication", {
        p_dataset_id: scope,
        p_id: z.uuid().parse(id),
        p_lease_token: z.uuid().parse(leaseToken),
        p_category: validated.reason,
        p_terminal: validated.status === "permanent-failure",
        p_retry_after_seconds: delay,
      });
      if (error) throw new Error("Analytics publication failure update failed");
      return z.boolean().parse(data);
    },
  };
}
export type DeliveryRepository = ReturnType<typeof createDeliveryRepository>;
