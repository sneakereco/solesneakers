import {
  createObservationQueryBudget,
  loadAnalyticsReport,
  reportCacheKey,
  type ReportLoaderDependencies,
} from "../../../Source/Features/Reporting/report-cache";
import {
  executePostHogQuery,
  PostHogQueryError,
} from "../../../Source/Features/Reporting/posthog-query";
import { readServerAnalyticsConfig } from "../../../Source/Features/Configuration/server-config";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { makeAudienceFixture } from "./audience-fixture";
import { request, scope } from "./commerce-fixture";
import {
  createReportStore,
  reserveReportProject,
} from "../../../Source/Features/Reporting/report-store";
import type { CompiledQuery } from "../../../Source/Features/Reporting/query-contract";
import { mockFetch, validEnv } from "../Configuration/config-fixture";

jest.mock("server-only", () => ({}), { virtual: true });
test.each(
  ["invalid-response", "invalid-aggregate", "invalid-summary"].flatMap((fault) =>
    [false, true].map((transientFirst) => ({ fault, transientFirst })),
  ),
)(
  "multiple required outcomes are decisive regardless of order: $fault, transient first $transientFirst",
  async ({ fault, transientFirst }) => {
    const { deps, tick } = setup();
    deps.history = { ...deps.history, observation: laggingObservation };
    const r = request("sales");
    expect((await loadAnalyticsReport(r, deps)).data).not.toBeNull();
    tick(301);
    const transient = Promise.withResolvers<unknown>(),
      invalid = Promise.withResolvers<unknown>();
    const both = Promise.withResolvers<void>();
    let calls = 0;
    deps.execute = (q) => {
      if (++calls === 2) both.resolve();
      return (q.endpoint === "sole_analytics_sales_series") ===
        (fault === "invalid-summary")
        ? transient.promise
        : invalid.promise;
    };
    const pending = loadAnalyticsReport(r, deps);
    await both.promise;
    const failTransient = () =>
      transient.reject(
        new PostHogQueryError({ status: "retryable", reason: "provider-unavailable" }),
      );
    const failOther = () =>
      fault === "invalid-response"
        ? invalid.reject(
            new PostHogQueryError({ status: "retryable", reason: "invalid-response" }),
          )
        : invalid.resolve({ columns: ["bad"], results: [[1]], hasMore: false });
    (transientFirst ? failTransient : failOther)();
    await new Promise((resolve) => setImmediate(resolve));
    (transientFirst ? failOther : failTransient)();
    expect(await pending).toMatchObject({ state: "unavailable", data: null });
    expect(calls).toBe(2);
  },
);
test.each(["acknowledged", "timeout"])(
  "subsecond initial shared 429 transition is attempted within deadline: %s",
  async (outcome) => {
    const { deps } = setup(),
      store = deps.store!;
    const timeout = outcome === "timeout" ? 45 : 800;
    const original = global.fetch;
    const aborted = jest.fn();
    const received = jest.fn();
    global.fetch = jest.fn((input, init) => {
      received(input);
      if (outcome === "acknowledged")
        return Promise.resolve(Response.json({ result: 1 }));
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted();
            reject(Error("stopped"));
          },
          { once: true },
        );
      });
    });
    try {
      const live = createReportStore();
      store.cooldown = jest.fn(live.cooldown);
      const gate = reserveReportProject(
        "short-budget-" + outcome,
        store,
        performance.now() + timeout,
      )!;
      const start = performance.now();
      try {
        await gate.rateLimited("permit", 30000);
        expect(gate.isBlocked()).toBe(true);
      } finally {
        gate.close();
      }
      expect(received).toHaveBeenCalledTimes(1);
      expect(store.cooldown).toHaveBeenCalledTimes(1);
      const args = jest.mocked(store.cooldown).mock.calls[0];
      expect(args[3]).toBeGreaterThan(0);
      expect(args[3]).toBeLessThanOrEqual(timeout);
      if (outcome === "timeout") {
        expect(aborted).toHaveBeenCalledTimes(1);
        expect(performance.now() - start).toBeLessThan(700);
      }
    } finally {
      global.fetch = original;
    }
  },
);
test.each([
  ["payments", "sole_analytics_payments"],
  ["health", "sole_analytics_health"],
  ["acquisition", "sole_analytics_discovery"],
  ["acquisition", "sole_analytics_discovery_series"],
] as const)(
  "a malformed fulfilled %s sibling %s vetoes fallback",
  async (report, endpoint) => {
    const { deps, f, tick } = setup();
    deps.history = { ...deps.history, observation: laggingObservation };
    const r = request(report, "compare=true");
    expect((await loadAnalyticsReport(r, deps)).data).not.toBeNull();
    tick(301);
    deps.execute = (q: CompiledQuery) => {
      if (
        report === "acquisition"
          ? q.endpoint === "sole_analytics_acquisition"
          : q.endpoint === endpoint &&
            q.variables.start_inclusive === r.range.startInclusive
      )
        return Promise.reject(
          new PostHogQueryError({ status: "retryable", reason: "provider-unavailable" }),
        );
      if (q.endpoint === endpoint)
        return Promise.resolve({
          columns: ["malformed"],
          results: [[0]],
          hasMore: false,
        });
      return f.execute(q);
    };
    expect(await loadAnalyticsReport(r, deps)).toMatchObject({
      state: "unavailable",
      data: null,
    });
  },
);
let fixtureProject = 0;
// Keep the warehouse verified and in the same freshness bucket while TTL advances.
const laggingObservation = {
  sourceFreshThrough: "2026-07-01T03:50:00.000Z",
  observedAt: "2026-07-01T04:00:00.000Z",
};
function setup() {
  const f = makeAudienceFixture();
  const entries = new Map<string, string>();
  const locks = new Map<string, string>();
  let now = f.deps.now;
  const deps: ReportLoaderDependencies = {
    project: "us:fixture-" + ++fixtureProject,
    dataset: scope,
    history: f.deps.history,
    clock: () => now,
    service: getReport,
    execute: jest.fn(f.execute),
    store: {
      read: (key) => Promise.resolve(entries.get(key) ?? null),
      lock: (key, owner) => {
        if (locks.has(key)) return Promise.resolve(false);
        locks.set(key, owner);
        return Promise.resolve(true);
      },
      finish: (key, owner, value) => {
        if (locks.get(key) === owner) {
          if (value) entries.set(key, value);
          locks.delete(key);
        }
        return Promise.resolve();
      },
      admit: () => Promise.resolve("ok"),
      release: async () => {},
      cooldown: async () => {},
    },
  };
  return {
    f,
    deps,
    entries,
    tick: (seconds: number) => {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}
test("overview keeps verified sales when traffic queries exhaust the query budget", async () => {
  jest.useFakeTimers();
  try {
    const { deps, f } = setup();
    f.sale("guest", "guest");
    deps.execute = (query, timeoutMs) => {
      if (
        query.endpoint === "sole_analytics_sales" ||
        query.endpoint === "sole_analytics_sales_series"
      )
        return new Promise((resolve) =>
          setTimeout(() => resolve(f.execute(query)), 6000),
        );
      return new Promise((_, reject) =>
        setTimeout(
          () => reject(new PostHogQueryError({ status: "retryable", reason: "timeout" })),
          timeoutMs,
        ),
      );
    };
    const completed = jest.fn();
    const pending = loadAnalyticsReport(request("overview"), deps).then(completed);
    try {
      await jest.advanceTimersByTimeAsync(19_500);
      expect(completed).toHaveBeenCalledWith(
        expect.objectContaining({
          state: "ready",
          data: expect.objectContaining({
            summary: expect.objectContaining({
              confirmedOrders: 1,
              sessions: null,
              visitors: null,
            }),
            series: [expect.objectContaining({ sessions: null, visitors: null })],
          }),
          coverage: expect.arrayContaining([
            expect.objectContaining({
              code: "component-unavailable",
              metric: "sessions",
            }),
            expect.objectContaining({
              code: "component-unavailable",
              metric: "visitorSeries",
            }),
          ]),
        }),
      );
    } finally {
      await jest.advanceTimersByTimeAsync(1000);
      await pending;
    }
  } finally {
    jest.useRealTimers();
  }
});
test("a slow provider response can finish before the shared report deadline", async () => {
  jest.useFakeTimers();
  const { deps } = setup();
  const query: CompiledQuery = {
    endpoint: "sole_analytics_sales",
    version: 1,
    variables: { dataset_id: "sole-staging" },
    limit: 1,
    offset: 0,
  };
  const payload = {
    name: query.endpoint,
    execution_id: "02ca5b65-a269-4c45-8d4a-0c74ff3ae670",
    endpoint_version: 1,
    columns: ["confirmed_orders"],
    results: [[4]],
    hasMore: false,
  };
  const fetch = mockFetch().mockImplementation(
    (_url, init) =>
      new Promise<Response>((resolve) => {
        const timer = setTimeout(() => resolve(Response.json(payload)), 10_500);
        init?.signal?.addEventListener("abort", () => clearTimeout(timer), {
          once: true,
        });
      }),
  );
  const config = readServerAnalyticsConfig(validEnv);
  const budget = createObservationQueryBudget(
    {
      ...deps,
      execute: (compiled, timeoutMs) =>
        executePostHogQuery(compiled, { config, fetch, timeoutMs, now: deps.clock }),
    },
    performance.now() + 20_000,
  );
  try {
    const first = budget.execute(query);
    void first.catch(() => {});
    await jest.advanceTimersByTimeAsync(10_500);
    await expect(first).resolves.toMatchObject({ results: [[4]] });

    const second = budget.execute(query);
    void second.catch(() => {});
    await jest.advanceTimersByTimeAsync(9_499);
    expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    await expect(second).rejects.toMatchObject({ reason: "timeout" });
  } finally {
    await jest.runOnlyPendingTimersAsync();
    await budget.close();
    jest.useRealTimers();
  }
});

test("the canonical request partitions every scope and joins identical concurrent loaders", async () => {
  const { deps, entries } = setup();
  const r = request("payments");
  expect(reportCacheKey(r, scope)).not.toBe(
    reportCacheKey({ ...r, source: "example" }, scope),
  );
  expect(reportCacheKey(r, scope)).not.toBe(
    reportCacheKey(r, { ...scope, financialSource: "events" }),
  );
  const [a, b] = await Promise.all([
    loadAnalyticsReport(r, deps),
    loadAnalyticsReport(r, deps),
  ]);
  expect(a.state).toBe("empty");
  expect(b).toEqual(a);
  expect(deps.execute).toHaveBeenCalledTimes(1);
  await loadAnalyticsReport(r, { ...deps, project: "eu:123" });
  expect(entries.size).toBe(2);
});
test.each(["none", "empty-cohorts", "prior"])(
  "expiring the only live reading respects independent activated-period evidence: %s",
  async (surviving) => {
    const { deps, f, tick } = setup();
    const r = request("customers", surviving === "prior" ? "compare=true" : "");
    const end = new Date(deps.clock().getTime() - 299000).toISOString();
    deps.history = {
      native: [{ start: "2026-07-01T03:00:00.000Z", end }],
      archive: [],
      observation: f.deps.history.observation,
    };
    deps.execute = async (q) => {
      if (q.endpoint === "sole_analytics_active") {
        const result = await f.execute(q);
        tick(2);
        return result;
      }
      if (
        q.endpoint === "sole_analytics_customer_cohorts" &&
        (surviving === "empty-cohorts" ||
          (surviving === "prior" &&
            q.variables.start_inclusive === r.range.comparisonStartInclusive))
      )
        return f.execute(q);
      throw new Error("fixture missing");
    };
    const result = await loadAnalyticsReport(r, deps);
    if (surviving === "none")
      expect(result).toMatchObject({ state: "unavailable", data: null });
    else if (surviving === "prior")
      expect(result.data).toMatchObject({
        activeWindow: null,
        comparison: { cohorts: [] },
      });
    else expect(result.data).toMatchObject({ activeWindow: null, cohorts: [] });
  },
);
test.each(["schema", "transport"])(
  "stale eligibility follows the required Overview result: %s",
  async (reason) => {
    const { deps, tick, f } = setup();
    const r = request("overview");
    await loadAnalyticsReport(r, deps);
    tick(61);
    deps.execute = async (q) => {
      if (q.endpoint === "sole_analytics_sales" && reason === "schema")
        return { columns: ["invalid"], results: [[1]], hasMore: false };
      if (
        q.endpoint === "sole_analytics_products" ||
        q.endpoint === "sole_analytics_sales"
      )
        throw new PostHogQueryError({
          status: "retryable",
          reason: "provider-unavailable",
        });
      return f.execute(q);
    };
    const result = await loadAnalyticsReport(r, deps);
    if (reason === "schema")
      expect(result).toMatchObject({ state: "unavailable", data: null });
    else expect(result).toMatchObject({ state: "stale", asOf: f.deps.now.toISOString() });
  },
);
test("a partitioned cooldown transition retains its permit, blocks fresh scopes and coalesces recovery", async () => {
  const { deps, f } = setup();
  const store = deps.store!;
  store.release = jest.fn().mockResolvedValue(undefined);
  const recovery = Promise.withResolvers<void>();
  const cooldown = jest
    .fn()
    .mockRejectedValueOnce(new Error("partition"))
    .mockRejectedValueOnce(new Error("partition"))
    .mockImplementation(() => recovery.promise);
  store.cooldown = cooldown;
  deps.execute = jest.fn().mockRejectedValue(
    new PostHogQueryError({
      status: "retryable",
      reason: "rate-limited",
      retryAfterMs: 30000,
    }),
  );
  expect((await loadAnalyticsReport(request("payments"), deps)).state).toBe(
    "unavailable",
  );
  expect(store.release).not.toHaveBeenCalled();
  expect(cooldown).toHaveBeenCalledTimes(2);
  // Admission has recovered but a missing distributed record must not reopen this project.
  deps.execute = jest.fn(f.execute);
  const elapsed = performance.now() + 1500;
  const monotonic = jest.spyOn(performance, "now").mockReturnValue(elapsed);
  try {
    const results = Promise.all(
      ["one", "two"].map((source) =>
        loadAnalyticsReport(request("payments", "source=" + source), deps),
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(cooldown).toHaveBeenCalledTimes(3);
    const [project, owner, delay] = cooldown.mock.calls[2];
    expect([project, owner]).toEqual(cooldown.mock.calls[0].slice(0, 2));
    expect(delay).toBeLessThan(30000);
    recovery.resolve();
    expect((await results).map((r) => r.state)).toEqual(["unavailable", "unavailable"]);
    expect(deps.execute).not.toHaveBeenCalled();
  } finally {
    recovery.resolve();
    monotonic.mockRestore();
  }
});
test("an already pending second-scope Redis admission cannot reopen the provider after a 429", async () => {
  const { deps } = setup(),
    store = deps.store!;
  const started = Promise.withResolvers<void>(),
    respond = Promise.withResolvers<unknown>();
  const requested = Promise.withResolvers<void>(),
    admitted = Promise.withResolvers<"ok">();
  deps.execute = jest.fn(() => {
    started.resolve();
    return respond.promise;
  });
  store.admit = jest
    .fn()
    .mockResolvedValueOnce("ok")
    .mockImplementationOnce(() => {
      requested.resolve();
      return admitted.promise;
    });
  store.cooldown = jest.fn().mockRejectedValue(new Error("write uncertain"));
  store.release = jest.fn().mockResolvedValue(undefined);
  const first = loadAnalyticsReport(request("payments"), deps);
  await started.promise;
  const second = loadAnalyticsReport(request("payments", "source=second"), deps);
  await requested.promise;
  respond.reject(
    new PostHogQueryError({
      status: "retryable",
      reason: "rate-limited",
      retryAfterMs: 30000,
    }),
  );
  expect((await first).state).toBe("unavailable");
  admitted.resolve("ok");
  expect((await second).state).toBe("unavailable");
  expect(deps.execute).toHaveBeenCalledTimes(1);
  expect(store.release).toHaveBeenCalledTimes(1);
  expect(jest.mocked(store.release).mock.calls[0]).toEqual(
    jest.mocked(store.admit).mock.calls[1],
  );
});
test("429 after expiry only serves a labeled matching report, with the original as-of", async () => {
  const { deps, tick } = setup();
  const r = request("payments");
  deps.history = { ...deps.history, observation: laggingObservation };
  const first = await loadAnalyticsReport(r, deps);
  tick(301);
  const limited = {
    ...deps,
    execute: () =>
      Promise.reject(
        new PostHogQueryError({ status: "retryable", reason: "rate-limited" }),
      ),
  };
  const stale = await loadAnalyticsReport(r, limited);
  expect(stale).toMatchObject({ asOf: first.asOf, data: first.data, state: "stale" });
  expect(await loadAnalyticsReport({ ...r, source: "other" }, limited)).toMatchObject({
    state: "unavailable",
    data: null,
  });
  tick(901);
  expect(await loadAnalyticsReport(r, limited)).toMatchObject({
    state: "unavailable",
    data: null,
  });
});
test.each(["products", "payments", "overview", "customers", "health"])(
  "historical %s with a current section refreshes in sixty seconds",
  async (report) => {
    const { deps, tick } = setup();
    deps.history = { ...deps.history, archive: [], native: [] };
    const r = request(report);
    const a = await loadAnalyticsReport(r, deps);
    tick(59);
    expect((await loadAnalyticsReport(r, deps)).asOf).toBe(a.asOf);
    tick(2);
    expect((await loadAnalyticsReport(r, deps)).asOf).not.toBe(a.asOf);
  },
);
test.each(["sales", "acquisition"])(
  "historical activity-basis %s can reuse a heavy result for 300 seconds",
  async (report) => {
    const { deps, tick } = setup();
    deps.history = { ...deps.history, observation: laggingObservation };
    const r = request(report);
    const initial = await loadAnalyticsReport(r, deps);
    tick(299);
    expect((await loadAnalyticsReport(r, deps)).asOf).toBe(initial.asOf);
    tick(2);
    expect((await loadAnalyticsReport(r, deps)).asOf).not.toBe(initial.asOf);
  },
);
test("the provider executor serializes excess parallel work and stops at project quota", async () => {
  const { f, deps } = setup();
  let active = 0,
    max = 0;
  deps.execute = async (q) => {
    max = Math.max(max, ++active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 3));
      return await f.execute(q);
    } finally {
      active--;
    }
  };
  const r = request("overview", "compare=true");
  expect((await loadAnalyticsReport(r, deps)).data).not.toBeNull();
  expect(max).toBe(2);
  deps.store!.admit = () => Promise.resolve("limited");
  deps.execute = jest.fn(f.execute);
  const limited = await loadAnalyticsReport(request("sales"), deps);
  expect(limited).toMatchObject({ data: null, state: "unavailable" });
  expect(deps.execute).not.toHaveBeenCalled();
});
test("a changed finite proof invalidates a cached report before its fresh TTL", async () => {
  const { deps } = setup();
  const r = request("customers");
  const a = await loadAnalyticsReport(r, deps);
  expect(a.data).toMatchObject({ sessions: 0 });
  const b = await loadAnalyticsReport(r, {
    ...deps,
    history: { ...deps.history, native: [] },
  });
  expect(b.data).toMatchObject({ sessions: null, activeWindow: null });
});
test("losing warehouse evidence cannot reuse an empty financial cache entry", async () => {
  const { deps } = setup();
  const r = request("sales");
  expect(await loadAnalyticsReport(r, deps)).toMatchObject({
    state: "empty",
    data: { confirmedOrders: 0 },
  });
  expect(
    await loadAnalyticsReport(r, {
      ...deps,
      history: { ...deps.history, observation: null },
    }),
  ).toMatchObject({ state: "unavailable", data: null });
});
test("shared store failure fails closed without endpoint work", async () => {
  const { deps } = setup();
  deps.store!.read = () => Promise.reject(new Error("private-fixture"));
  const result = await loadAnalyticsReport(request("payments"), deps);
  expect(result).toMatchObject({ data: null, state: "unavailable" });
  expect(JSON.stringify(result)).not.toContain("private-fixture");
  expect(deps.execute).not.toHaveBeenCalled();
});
test("a stale active window is suppressed even when the prior result remains eligible", async () => {
  const { deps, tick } = setup();
  deps.history = {
    ...deps.history,
    observation: null,
    native: [{ start: scope.activatedAt, end: deps.clock().toISOString() }],
  };
  const r = request("customers");
  const a = await loadAnalyticsReport(r, deps);
  expect(a.data).toMatchObject({ activeFiveMinuteVisitors: 0 });
  tick(301);
  deps.execute = () =>
    Promise.reject(
      new PostHogQueryError({
        status: "retryable",
        reason: "rate-limited",
        retryAfterMs: 120000,
      }),
    );
  const b = await loadAnalyticsReport(r, deps);
  expect(b).toMatchObject({
    state: "stale",
    asOf: a.asOf,
    data: { activeWindow: null, activeFiveMinuteVisitors: null },
  });
  expect(b.coverage).toContainEqual(
    expect.objectContaining({ metric: "activeFiveMinuteVisitors" }),
  );
});
test("limited optional behavior preserves newer independently verified product sections", async () => {
  const { deps, f, tick } = setup();
  const r = request("products");
  await loadAnalyticsReport(r, deps);
  tick(61);
  deps.execute = async (q) => {
    if (q.endpoint === "sole_analytics_products")
      throw new PostHogQueryError({ status: "retryable", reason: "network" });
    return f.execute(q);
  };
  const b = await loadAnalyticsReport(r, deps);
  expect(b).toMatchObject({
    data: { products: null, inventory: { recordedVariants: 0 } },
    state: "ready",
  });
});
test("expired owners or busy followers cannot bypass shared admission", async () => {
  const { deps } = setup();
  deps.store!.lock = () => Promise.resolve(false);
  deps.deadline = performance.now() + 80;
  const r = await loadAnalyticsReport(request("sales"), deps);
  expect(r).toMatchObject({ data: null, state: "unavailable" });
  expect(deps.execute).not.toHaveBeenCalled();
});
test("a live-only selection becomes wholly unavailable when its sole reading expires during loading", async () => {
  const { deps, tick, f } = setup();
  const at = deps.clock().getTime();
  deps.history = {
    native: [{ start: scope.activatedAt, end: new Date(at - 299000).toISOString() }],
    archive: [],
    observation: null,
  };
  deps.execute = async (q) => {
    const value = await f.execute(q);
    tick(2);
    return value;
  };
  const futureActivation = { ...scope, activatedAt: "2026-06-28T00:00:00.000Z" };
  const b = await loadAnalyticsReport(request("customers"), {
    ...deps,
    dataset: futureActivation,
  });
  expect(b).toMatchObject({ state: "unavailable", data: null });
});
