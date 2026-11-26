import "server-only";
import { after } from "next/server";
import { createScopedSupabaseAdminClient } from "@/lib/supabase/service-role";
import { createFactRepository } from "../CommerceFacts/repository";
import { readServerAnalyticsConfig } from "../Configuration/server-config";
import { resolveActiveDataset } from "../Configuration/dataset";
import { createDeliveryRepository } from "./delivery-repository";
import { deliverAnalyticsBatch } from "./delivery-worker";

export async function runAnalyticsDrain() {
  const config = readServerAnalyticsConfig(process.env);
  if (!config) throw new Error("Analytics configuration unavailable");
  const budget = 8000;
  const deadline = performance.now() + budget;
  const signal = AbortSignal.timeout(budget);
  const boundedFetch: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    });
  const db = createScopedSupabaseAdminClient(boundedFetch);
  const facts = createFactRepository(db);
  const scope = await resolveActiveDataset(facts, config.environment);
  if (!scope) throw new Error("Analytics dataset unavailable");
  const queue = createDeliveryRepository(db, scope.datasetId);
  return deliverAnalyticsBatch(
    {
      ...queue,
      getActivePurchaseContext: facts.getActivePurchaseContext,
      config,
      fetch: boundedFetch,
      now: () => new Date(),
    },
    { limit: 200, deadlineMs: deadline - performance.now() },
  );
}

export function scheduleAnalyticsDrain() {
  if (!readServerAnalyticsConfig(process.env)) return;
  try {
    after(async () => {
      try {
        await runAnalyticsDrain();
      } catch {
        console.warn("analytics_drain_unavailable");
      }
    });
  } catch {
    console.warn("analytics_drain_schedule_unavailable");
  }
}
