import "server-only";

import { z } from "zod";

import {
  requestPostHogJson,
  type PostHogFailure,
  type PostHogRequestDependencies,
} from "../Configuration/posthog-request";
import {
  isServerAnalyticsConfig,
  type ServerAnalyticsConfig,
} from "../Configuration/server-config";

import {
  CSV_EXECUTION,
  ExportScopeError,
  validateCompiledQuery,
  type CompiledQuery,
  type CsvExecution,
} from "./query-contract";

const QUERY_TIMEOUT_MS = 8_000;
const endpointResponse = z.object({
  name: z.string(),
  execution_id: z.uuid(),
  endpoint_version: z.number().int(),
  columns: z.array(z.string().min(1)).min(1),
  results: z.array(z.array(z.unknown())),
  hasMore: z.boolean(),
  truncated: z.boolean().optional(),
});

export const WAREHOUSE_OBSERVATION_EXECUTION = Symbol("warehouse-observation");

export type QueryDependencies = PostHogRequestDependencies & {
  mode?: CsvExecution | typeof WAREHOUSE_OBSERVATION_EXECUTION;
  config: ServerAnalyticsConfig | null;
};

export type PostHogQueryResult = {
  columns: string[];
  results: unknown[][];
  hasMore: boolean;
};

type QueryFailure =
  | PostHogFailure
  | { status: "permanent-failure"; reason: "invalid-query" };

export class PostHogQueryError extends Error {
  readonly category: QueryFailure["status"];
  readonly reason: QueryFailure["reason"];
  readonly retryAfterMs?: number;

  constructor(failure: QueryFailure) {
    super(`PostHog report request failed (${failure.reason})`);
    this.name = "PostHogQueryError";
    this.category = failure.status;
    this.reason = failure.reason;
    if (failure.status === "retryable" && failure.retryAfterMs !== undefined) {
      this.retryAfterMs = failure.retryAfterMs;
    }
  }
}

export function isTransientReportError(error: unknown): error is PostHogQueryError {
  return (
    error instanceof PostHogQueryError &&
    error.category === "retryable" &&
    error.reason !== "invalid-response"
  );
}

export async function executePostHogQuery(
  query: CompiledQuery,
  deps: QueryDependencies,
): Promise<unknown> {
  const { config } = deps;
  if (!isServerAnalyticsConfig(config)) {
    throw new PostHogQueryError({
      status: "configuration-failure",
      reason: "not-configured",
    });
  }
  const csv = deps.mode === CSV_EXECUTION;
  const compiled = validateCompiledQuery(query, csv ? CSV_EXECUTION : undefined);
  if (!compiled) {
    throw new PostHogQueryError({ status: "permanent-failure", reason: "invalid-query" });
  }

  const { endpoint, version, variables, limit, offset } = compiled;
  const response = await requestPostHogJson(
    `${config.apiHost}/api/projects/${config.projectId}/endpoints/${endpoint}/run/`,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.queryApiKey}`,
      },
      // Reports use inline endpoints so an app cache miss can fetch fresh data.
      body: JSON.stringify({ version, variables, limit, offset, refresh: "force" }),
    },
    deps,
    QUERY_TIMEOUT_MS,
  );
  if (response.status !== "ok") {
    throw new PostHogQueryError(response);
  }

  const parsed = endpointResponse.safeParse(response.data);
  if (
    !parsed.success ||
    parsed.data.name !== endpoint ||
    parsed.data.endpoint_version !== version ||
    new Set(parsed.data.columns).size !== parsed.data.columns.length ||
    parsed.data.results.some((row) => row.length !== parsed.data.columns.length)
  ) {
    throw new PostHogQueryError({ status: "retryable", reason: "invalid-response" });
  }

  const { columns, results, hasMore, truncated } = parsed.data;
  if (csv && (hasMore || truncated || results.length > limit))
    throw new ExportScopeError();
  const warehouseObservation =
    deps.mode === WAREHOUSE_OBSERVATION_EXECUTION &&
    (endpoint === "sole_analytics_observe_finance" ||
      endpoint === "sole_analytics_observe_links");
  if (results.length > limit || (truncated && !warehouseObservation)) {
    throw new PostHogQueryError({ status: "retryable", reason: "invalid-response" });
  }
  const data = { columns, results, hasMore } satisfies PostHogQueryResult;
  return truncated ? { ...data, truncated } : data;
}
