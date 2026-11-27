import "server-only";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { createFactRepository } from "../CommerceFacts/repository";
import { readServerAnalyticsConfig } from "../Configuration/server-config";
import { DATASET_IDS, resolveActiveDataset } from "../Configuration/dataset";
import { isUuid, type ConsentState } from "./contract";

import { configuredMeasurement, isApprovedMeasurementHostname } from "./host-gate";
export function acceptsMeasurementHost(hostname: string) {
  const config = configuredMeasurement();
  return Boolean(config && isApprovedMeasurementHostname(hostname, config.environment));
}
export const preferenceCookie = "__Host-sole_analytics";
export const privateHeaders = { "Cache-Control": "private, no-store" };
async function preference() {
  return (await cookies()).get(preferenceCookie)?.value;
}
function serverContext() {
  const config = readServerAnalyticsConfig(process.env);
  if (!config) throw new Error("Analytics configuration unavailable");
  return { repo: createFactRepository(createSupabaseAdminClient()), config };
}
export async function readServerConsent(): Promise<ConsentState> {
  const prior = await preference();
  if (prior === "declined") return { choice: "declined" };
  if (!isUuid(prior)) return { choice: "unknown" };
  const { repo, config } = serverContext();
  const dataset = await resolveActiveDataset(repo, config.environment);
  return dataset && (await repo.isReceiptActive(dataset.datasetId, prior))
    ? { choice: "accepted", receiptId: prior }
    : { choice: "unknown" };
}
export async function updateServerConsent(
  choice: "declined" | "accepted",
): Promise<ConsentState> {
  const prior = await preference();
  if (choice === "declined") {
    if (isUuid(prior)) {
      const { repo, config } = serverContext();
      // Withdrawal also applies after a dataset has been deactivated.
      await repo.revokeReceipt(DATASET_IDS[config.environment], prior);
    }
    return { choice };
  }
  const { repo, config } = serverContext();
  const dataset = await resolveActiveDataset(repo, config.environment);
  if (!dataset) throw new Error("Dataset unavailable");
  if (isUuid(prior) && (await repo.isReceiptActive(dataset.datasetId, prior)))
    return { choice, receiptId: prior };
  return { choice, receiptId: (await repo.issueReceipt(dataset.datasetId)).receiptId };
}
