export function targetFixture(overrides = {}) {
  return {
    version: 1,
    purpose: "staging-load-test",
    baseUrl: "https://load-fixture.example.test",
    expected: {
      commit: "a".repeat(40),
      deploymentId: "dpl_fixture",
      projectId: "prj_load_fixture",
    },
    resources: {
      supabase: { projectRef: "loadfixture", url: "https://loadfixture.supabase.co" },
      redis: { id: "redis_load_fixture", url: "https://load-fixture.upstash.io" },
    },
    productionDenylist: {
      hosts: ["www.production.example.test"],
      projectIds: ["prj_production_fixture"],
      supabaseRefs: ["productionfixture"],
      redisIds: ["redis_production_fixture"],
    },
    migrationHeads: ["20261124120000"],
    providerMode: "simulated",
    requiredCapabilities: ["shopping", "specialty-claims"],
    telemetry: ["application", "database", "redis", "queues", "generator"],
    region: "us-east",
    budget: {
      maxCostUsd: 0,
      maxRequests: 20000000,
      maxDurationSeconds: 21600,
      maxSessions: 12000,
    },
    ...structuredClone(overrides),
  };
}
export const RUN_OPTIONS = {
  runId: "11111111-1111-4111-8111-111111111111",
  startedAt: "2026-11-25T15:00:00.000Z",
};
