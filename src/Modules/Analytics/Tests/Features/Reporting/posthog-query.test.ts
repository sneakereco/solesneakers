import { readServerAnalyticsConfig } from "../../../Source/Features/Configuration/server-config";
import { executePostHogQuery } from "../../../Source/Features/Reporting/posthog-query";
import type { CompiledQuery } from "../../../Source/Features/Reporting/query-contract";

import {
  mockFetch,
  now,
  privateQueryKey,
  validEnv,
} from "../Configuration/config-fixture";

jest.mock("server-only", () => ({}), { virtual: true });

const query: CompiledQuery = {
  endpoint: "sole_analytics_sales",
  version: 1,
  variables: { dataset_id: "sole-staging-v2", status: "paid" },
  limit: 1,
  offset: 2,
};

const payload = {
  name: "sole_analytics_sales",
  execution_id: "02ca5b65-a269-4c45-8d4a-0c74ff3ae670",
  endpoint_version: 1,
  columns: ["confirmed_orders"],
  results: [[4]],
  hasMore: true,
};

it("forces a fresh versioned SQL endpoint read with explicit pagination", async () => {
  const fetch = mockFetch().mockResolvedValue(
    Response.json({ ...payload, debug: privateQueryKey }),
  );
  const config = readServerAnalyticsConfig({
    ...validEnv,
    NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
    POSTHOG_API_HOST: "https://eu.posthog.com",
  });

  await expect(executePostHogQuery(query, { config, fetch, now })).resolves.toEqual({
    columns: ["confirmed_orders"],
    results: [[4]],
    hasMore: true,
  });
  const [[url, request]] = fetch.mock.calls;
  expect(url).toBe(
    "https://eu.posthog.com/api/projects/741/endpoints/sole_analytics_sales/run/",
  );
  expect(request).toMatchObject({
    method: "POST",
    redirect: "manual",
    cache: "no-store",
  });
  expect(new Headers(request?.headers).get("authorization")).toBe(
    `Bearer ${privateQueryKey}`,
  );
  expect(JSON.parse(String(request?.body))).toEqual({
    version: 1,
    variables: { dataset_id: "sole-staging-v2", status: "paid" },
    limit: 1,
    offset: 2,
    refresh: "force",
  });
});

it.each([
  ["unregistered endpoint", { endpoint: "../query" }],
  ["inherited name", { endpoint: "constructor" }],
  ["unregistered version", { version: 2 }],
  ["missing version", { version: undefined }],
  ["zero limit", { limit: 0 }],
  ["out of range limit", { limit: 2001 }],
  ["out of range offset", { offset: 100001 }],
  ["nested variable input", { variables: { dataset_id: { dataset: 1 } } }],
  ["non-finite variable input", { variables: { x: Number.POSITIVE_INFINITY } }],
  ["debug override", { debug: true }],
  ["refresh override", { refresh: "cache" }],
  ["arbitrary SQL", { query: "SELECT 1" }],
])("rejects %s without requesting provider", async (_label, patch) => {
  const fetch = mockFetch();
  await expect(
    executePostHogQuery({ ...query, ...patch } as CompiledQuery, {
      config: readServerAnalyticsConfig(validEnv),
      fetch,
      now,
    }),
  ).rejects.toMatchObject({ category: "permanent-failure", reason: "invalid-query" });
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects an injected custom API host without requesting provider", async () => {
  const fetch = mockFetch();
  const config = readServerAnalyticsConfig(validEnv)!;
  await expect(
    executePostHogQuery(query, {
      config: {
        ...config,
        apiHost: "https://custom.example.com",
      } as unknown as typeof config,
      fetch,
      now,
    }),
  ).rejects.toMatchObject({
    category: "configuration-failure",
    reason: "not-configured",
  });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  [308, "configuration-failure", "redirect"],
  [401, "configuration-failure", "unauthorized"],
  [403, "configuration-failure", "unauthorized"],
  [404, "configuration-failure", "not-found"],
  [429, "retryable", "rate-limited"],
  [503, "retryable", "provider-unavailable"],
])("classifies HTTP %s and redacts failures", async (code, category, reason) => {
  const fetch = mockFetch().mockResolvedValue(
    new Response(privateQueryKey, {
      status: code,
      headers: { location: "https://custom.example.com/secret" },
    }),
  );
  const error = await executePostHogQuery(query, {
    config: readServerAnalyticsConfig(validEnv),
    fetch,
    now,
  }).catch((failure: unknown) => failure);
  expect(error).toMatchObject({ category, reason });
  expect(JSON.stringify(error)).not.toContain(privateQueryKey);
  expect(String(error)).not.toContain(privateQueryKey);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("uses its injected clock for Retry-After dates", async () => {
  const fetch = mockFetch().mockResolvedValue(
    new Response(null, {
      status: 429,
      headers: { "retry-after": "Wed, 25 Nov 2026 12:00:30 GMT" },
    }),
  );
  await expect(
    executePostHogQuery(query, {
      config: readServerAnalyticsConfig(validEnv),
      fetch,
      now,
    }),
  ).rejects.toMatchObject({ category: "retryable", retryAfterMs: 30_000 });
});

it.each([
  ["absent columns", { columns: undefined }],
  [
    "duplicate columns",
    { columns: ["confirmed_orders", "confirmed_orders"], results: [[3, 4]] },
  ],
  ["wrong row width", { results: [[4, 5]] }],
  ["object row", { results: [{ confirmed_orders: 4 }] }],
  ["over-limit page", { results: [[4], [5]] }],
  ["missing pagination flag", { hasMore: undefined }],
  ["different version", { endpoint_version: 2 }],
  ["different endpoint", { name: "sole_analytics_health" }],
  ["truncated results", { truncated: true }],
])("rejects malformed result with %s", async (_label, patch) => {
  const fetch = mockFetch().mockResolvedValue(Response.json({ ...payload, ...patch }));
  await expect(
    executePostHogQuery(query, {
      config: readServerAnalyticsConfig(validEnv),
      fetch,
      now,
    }),
  ).rejects.toMatchObject({ reason: "invalid-response" });
});

it("includes the response body in the query deadline", async () => {
  jest.useFakeTimers();
  try {
    const stream = new ReadableStream({ pull: () => new Promise(() => {}) });
    const fetch = mockFetch().mockResolvedValue(new Response(stream));
    const result = executePostHogQuery(query, {
      config: readServerAnalyticsConfig(validEnv),
      fetch,
      now,
      timeoutMs: 40,
    });
    const assertion = expect(result).rejects.toMatchObject({
      category: "retryable",
      reason: "timeout",
    });
    await jest.advanceTimersByTimeAsync(40);
    await assertion;
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
