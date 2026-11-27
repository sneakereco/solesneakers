import "server-only";

import { createScopedSupabaseAdminClient } from "@/lib/supabase/service-role";
import { createFactRepository } from "../CommerceFacts/repository";
import { resolveActiveDataset } from "../Configuration/dataset";
import { readServerAnalyticsConfig } from "../Configuration/server-config";
import {
  readHistoryEvidence,
  type HistoryEvidence,
} from "../EventDelivery/history-source";
import type { ReportRequest } from "../ReportContract/types";
import { executePostHogQuery } from "./posthog-query";
import { loadAnalyticsReport } from "./report-cache";
import { getReport } from "./report-service";
import { createReportStore } from "./report-store";
import { CSV_EXECUTION, ExportScopeError, type CsvExecution } from "./query-contract";

const noEvidence: HistoryEvidence = { native: [], archive: [], observation: null };
export async function loadServerReport(
  request: ReportRequest,
  { deadline, mode }: { deadline: number; mode?: CsvExecution },
) {
  const config = readServerAnalyticsConfig(process.env);
  const clock = () => new Date();
  if (!config)
    return getReport(request, {
      dataset: null,
      now: clock(),
      history: noEvidence,
      execute: () => Promise.reject(new Error("Analytics unavailable.")),
    });
  const dbTimeout = AbortSignal.timeout(
    Math.max(1, Math.min(3000, Math.floor(deadline - performance.now()))),
  );
  const db = createScopedSupabaseAdminClient((input, init) =>
    fetch(input, {
      ...init,
      cache: "no-store",
      signal: init?.signal ? AbortSignal.any([dbTimeout, init.signal]) : dbTimeout,
    }),
  );
  const dataset = await resolveActiveDataset(
    createFactRepository(db),
    config.environment,
    clock(),
  );
  let history = noEvidence;
  if (dataset) {
    // Provider aggregates alone cannot establish complete source coverage.
    try {
      history = await readHistoryEvidence(db, dataset.datasetId);
    } catch {
      history = noEvidence;
    }
  }
  let remainingBytes = 32 * 1024 * 1024;
  return loadAnalyticsReport(request, {
    mode,
    deadline,
    dataset,
    history,
    clock,
    project: config.apiHost + "/" + config.projectId,
    store: dataset ? createReportStore() : null,
    service: getReport,
    execute: async (query, timeoutMs) => {
      // Count actual decompressed bytes before JSON decoding, even without Content-Length.
      let tooLarge = false;
      const boundedFetch: typeof fetch = async (input, init) => {
        const response = await fetch(input, init);
        if (!response.ok || response.redirected || !response.body) return response;
        let bytes = 0;
        const stream = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytes += chunk.byteLength;
              remainingBytes -= chunk.byteLength;
              if (bytes > 8 * 1024 * 1024 || remainingBytes < 0) {
                tooLarge = true;
                controller.error(new Error("Report response exceeded its limit."));
                return;
              }
              controller.enqueue(chunk);
            },
          }),
        );
        return new Response(stream, {
          status: response.status,
          headers: response.headers,
        });
      };
      try {
        return await executePostHogQuery(query, {
          config,
          now: clock,
          fetch: boundedFetch,
          timeoutMs,
          mode,
        });
      } catch (error) {
        if (tooLarge && mode === CSV_EXECUTION) throw new ExportScopeError();
        throw error;
      }
    },
  });
}
