import "server-only";
import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import {
  analyticsFactSchema,
  datasetIdSchema,
  datasetScopeSchema,
  factFields,
  factPayloadSchemas,
  type AnalyticsFact,
  type DatasetScope,
} from "./contract";

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .refine((value) => !/[a-z0-9]{24,}|token|secret|password|auth|session|key/.test(value));
export const acquisitionDimensionsSchema = z.strictObject({
  source: slug.optional(),
  channel: slug.optional(),
  campaign: slug.optional(),
  placement: slug.optional(),
});
export const privateTrackingSchema = z.strictObject({
  receiptId: z.uuid(),
  visitorId: z.union([z.uuid(), factFields.buyerKey.unwrap()]),
  sessionId: z.uuid(),
  device: z.enum(["desktop", "mobile", "tablet", "unknown"]),
  discovery: acquisitionDimensionsSchema.nullable(),
  purchaseSession: acquisitionDimensionsSchema.nullable(),
});
export type PrivateTrackingContext = z.infer<typeof privateTrackingSchema>;
export const orderContextSchema = z.strictObject({
  datasetId: datasetIdSchema,
  orderId: z.uuid(),
  buyerKey: factFields.buyerKey,
  lineSnapshots: z.array(factPayloadSchemas.line),
  tracking: privateTrackingSchema.nullable(),
});
export type PrivateOrderContext = z.infer<typeof orderContextSchema>;

const receiptRow = z.strictObject({
  receipt_id: z.uuid(),
  granted_at: factFields.recordedAt,
  revoked_at: factFields.recordedAt.nullable(),
});
export type ConsentReceipt = {
  receiptId: string;
  grantedAt: string;
  revokedAt: string | null;
};

export function createFactRepository(db: AdminSupabaseClient) {
  return {
    async appendFact(fact: AnalyticsFact): Promise<string> {
      const { data, error } = await db.rpc("analytics_append_fact", {
        p_fact: analyticsFactSchema.parse(fact),
      });
      if (error) throw new Error("Analytics fact append failed");
      return z.uuid().parse(data);
    },
    async getDataset(datasetId: string): Promise<DatasetScope | null> {
      const { data, error } = await db
        .from("analytics_datasets")
        .select(
          "dataset_id,environment,activated_at,schema_version,financial_source,behavior_archive_cutoff",
        )
        .eq("dataset_id", datasetIdSchema.parse(datasetId))
        .maybeSingle();
      if (error) throw new Error("Analytics dataset lookup failed");
      return data
        ? datasetScopeSchema.parse({
            datasetId: data.dataset_id,
            environment: data.environment,
            activatedAt: data.activated_at,
            schemaVersion: data.schema_version,
            financialSource: data.financial_source,
            behaviorArchiveCutoff: data.behavior_archive_cutoff,
          })
        : null;
    },
    async issueReceipt(datasetId: string): Promise<ConsentReceipt> {
      const { data, error } = await db
        .from("analytics_consent_receipts")
        .insert({ dataset_id: datasetIdSchema.parse(datasetId) })
        .select("receipt_id,granted_at,revoked_at")
        .single();
      if (error) throw new Error("Analytics receipt creation failed");
      const row = receiptRow.parse(data);
      return {
        receiptId: row.receipt_id,
        grantedAt: row.granted_at,
        revokedAt: row.revoked_at,
      };
    },
    async isReceiptActive(datasetId: string, receiptId: string): Promise<boolean> {
      const { data, error } = await db
        .from("analytics_consent_receipts")
        .select("receipt_id")
        .eq("dataset_id", datasetIdSchema.parse(datasetId))
        .eq("receipt_id", z.uuid().parse(receiptId))
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw new Error("Analytics receipt lookup failed");
      return data !== null;
    },
    async revokeReceipt(datasetId: string, receiptId: string): Promise<boolean> {
      const { data, error } = await db.rpc("analytics_revoke_receipt", {
        p_dataset_id: datasetIdSchema.parse(datasetId),
        p_receipt_id: z.uuid().parse(receiptId),
      });
      if (error) throw new Error("Analytics receipt revocation failed");
      return z.boolean().parse(data);
    },
    // A fresh joined read is required for each tracked publication attempt.
    async getActivePurchaseContext(
      datasetId: string,
      orderId: string,
    ): Promise<{ publicationId: string; tracking: PrivateTrackingContext } | null> {
      const { data, error } = await db
        .from("analytics_order_context")
        .select(
          "tracked_publication_id,receipt_id,visitor_id,session_id,device,discovery,purchase_session,analytics_consent_receipts!inner(revoked_at)",
        )
        .eq("dataset_id", datasetIdSchema.parse(datasetId))
        .eq("order_id", z.uuid().parse(orderId))
        .is("analytics_consent_receipts.revoked_at", null)
        .maybeSingle();
      if (error) throw new Error("Analytics purchase context lookup failed");
      if (!data) return null;
      return {
        publicationId: z.uuid().parse(data.tracked_publication_id),
        tracking: privateTrackingSchema.parse({
          receiptId: data.receipt_id,
          visitorId: data.visitor_id,
          sessionId: data.session_id,
          device: data.device,
          discovery: data.discovery,
          purchaseSession: data.purchase_session,
        }),
      };
    },
  };
}
export type FactRepository = ReturnType<typeof createFactRepository>;
