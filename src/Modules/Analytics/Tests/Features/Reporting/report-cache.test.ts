import {
  loadAnalyticsReport,
  reportCacheKey,
  type ReportLoaderDependencies,
} from "../../../Source/Features/Reporting/report-cache";
import { PostHogQueryError } from "../../../Source/Features/Reporting/posthog-query";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { makeAudienceFixture } from "./audience-fixture";
import { request, scope } from "./commerce-fixture";

jest.mock("server-only", () => ({}), { virtual: true });
function setup() {
  const f = makeAudienceFixture();
  const entries = new Map<string, string>();
  const locks = new Map<string, string>();
  let now = f.deps.now;
  const deps: ReportLoaderDependencies = {
    project: "us:123",
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
test("429 after expiry only serves a labeled matching report, with the original as-of", async () => {
  const { deps, tick } = setup();
  const r = request("payments");
  deps.history = { ...deps.history, observation: null };
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
    deps.history = { archive: [], native: [], observation: null };
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
    deps.history = { ...deps.history, observation: null };
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
  deps.history = { ...deps.history, observation: null };
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
