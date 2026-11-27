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
  truncated: z.literal(false).optional(),
});

export type QueryDependencies = PostHogRequestDependencies & {
  mode?: CsvExecution;
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
  const compiled = validateCompiledQuery(query, deps.mode);
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
    deps.mode === CSV_EXECUTION &&
    typeof response.data === "object" &&
    response.data !== null &&
    (("hasMore" in response.data && response.data.hasMore === true) ||
      ("truncated" in response.data && response.data.truncated === true) ||
      ("results" in response.data &&
        Array.isArray(response.data.results) &&
        response.data.results.length > limit))
  )
    throw new ExportScopeError();
  if (
    !parsed.success ||
    parsed.data.name !== endpoint ||
    parsed.data.endpoint_version !== version ||
    parsed.data.results.length > limit ||
    new Set(parsed.data.columns).size !== parsed.data.columns.length ||
    parsed.data.results.some((row) => row.length !== parsed.data.columns.length)
  ) {
    throw new PostHogQueryError({ status: "retryable", reason: "invalid-response" });
  }

  const { columns, results, hasMore } = parsed.data;
  return { columns, results, hasMore } satisfies PostHogQueryResult;
}
