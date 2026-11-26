import "server-only";
import type { FactRepository } from "../CommerceFacts/repository";
import type { PublicAnalyticsConfig } from "./public-config";

export const DATASET_IDS = {
  staging: "sole-staging",
  production: "sole-production",
} as const;

export async function resolveActiveDataset(
  repository: Pick<FactRepository, "getDataset">,
  environment: PublicAnalyticsConfig["environment"],
  now = new Date(),
) {
  const id = DATASET_IDS[environment];
  const row = await repository.getDataset(id);
  return row?.datasetId === id &&
    row.environment === environment &&
    row.schemaVersion === 2 &&
    Date.parse(row.activatedAt) <= now.getTime()
    ? row
    : null;
}
