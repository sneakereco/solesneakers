import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { buildManifest } from "../../scripts/admin-analytics-manifest.mjs";
import {
  planProvisioning,
  provisionAnalytics,
} from "../../scripts/provision-admin-analytics.mjs";

const args = { environment: "staging", at: "2026-12-01T12:00:00Z" };
const projectKey = "phc_fixturecapturekey0123456789";
const runtimeKey = "phs_fixtureruntimekey0123456789";
const operatorKey = "phx_fixtureoperatorkey0123456789";
const provisionKey = "phx_fixtureprovisionkey0123456789";
const canary = "PROVIDER_SECRET_CANARY";
const org = "80d87d84-6ef4-4c36-8dfd-d616292c5a72";
const host = "https://us.posthog.com";
const base = "/api/projects/501/";
const env = {
  NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: "staging",
  NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
  NEXT_PUBLIC_POSTHOG_PROJECT_KEY: projectKey,
  POSTHOG_API_HOST: host,
  POSTHOG_PROJECT_ID: "501",
  POSTHOG_QUERY_API_KEY: runtimeKey,
  ANALYTICS_IDENTITY_SECRET: "01234567890123456789012345678901",
  POSTHOG_OWNER_ORGANIZATION_ID: org,
  POSTHOG_OWNER_STAGING_PROJECT_ID: "501",
  POSTHOG_OWNER_PRODUCTION_PROJECT_ID: "502",
  POSTHOG_OPERATOR_API_KEY: operatorKey,
  POSTHOG_PROVISIONING_KEY: provisionKey,
};

function provider() {
  const variables = new Map();
  const endpoints = new Map();
  const writes = [];
  const reads = [];
  const control = {};
  const no = (status) => Response.json({ detail: canary }, { status });
  const fetch = async (raw, init) => {
    const url = new URL(raw);
    assert.equal(url.origin, host);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    if (url.pathname === `/api/organizations/${org}/projects/501/`) {
      assert.equal(init.headers.Authorization, "Bearer " + operatorKey);
      assert.equal(init.method, "GET");
      return Response.json({
        id: control.foreignProject ? 502 : 501,
        organization: org,
        api_token: projectKey,
        anonymize_ips: true,
      });
    }
    assert.equal(init.headers.Authorization, "Bearer " + provisionKey);
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      writes.push({ path: url.pathname, body });
      if (url.pathname === base + "insight_variables/") {
        const variable = {
          ...body,
          code_name: body.name,
          id: `11a87d84-6ef4-4c36-8dfd-${String(71 + variables.size).padStart(12, "0")}`,
        };
        assert.equal(variables.has(body.name), false);
        variables.set(body.name, variable);
        return control.variableConflict
          ? no(400)
          : Response.json(variable, { status: 201 });
      }
      assert.equal(url.pathname, base + "endpoints/");
      if (control.rejectWithoutWrite) return no(409);
      assert.equal(endpoints.has(body.name), false);
      for (const [id, binding] of Object.entries(body.query.variables)) {
        const variable = variables.get(binding.code_name);
        assert.equal(id, variable.id);
        assert.equal(binding.variableId, id);
        assert.equal(binding.value, variable.default_value);
        assert.equal("type" in binding, false);
      }
      endpoints.set(body.name, {
        ...body,
        version: 1,
        version_id: "stored-version",
        endpoint_is_active: true,
        materialization: { enabled: false },
        query: { ...body.query, limit: null },
      });
      if (control.lostResponse) throw new Error(canary);
      if (control.endpointConflict) return no(409);
      return Response.json({ name: body.name, current_version: 1 }, { status: 201 });
    }
    assert.equal(init.method, "GET");
    reads.push(url.pathname + url.search);
    if (url.pathname === base + "insight_variables/") {
      if (control.oversizedPage) {
        return new Response(canary.repeat(200000));
      }
      if (control.next) {
        return Response.json({ results: [], next: control.next });
      }
      const rows = [...variables.values()];
      if (control.paginate && rows.length > 3 && !url.search)
        return Response.json({
          results: rows.slice(0, 3),
          next: base + "insight_variables/?offset=3",
        });
      return Response.json({ results: url.search ? rows.slice(3) : rows, next: null });
    }
    assert.match(url.pathname, /^\/api\/projects\/501\/endpoints\/sole_analytics_\w+\/$/);
    const name = url.pathname.split("/").at(-2);
    const endpoint = endpoints.get(name);
    if (!endpoint) return no(404);
    if (url.search && control.pinnedDelayed && !control.pinnedSeen) {
      control.pinnedSeen = true;
      return no(404);
    }
    return Response.json(
      url.search ? endpoint : { name, current_version: control.currentVersion ?? 1 },
    );
  };
  return { variables, endpoints, writes, reads, control, fetch };
}

function write(p, settings = env) {
  return provisionAnalytics({
    ...args,
    write: true,
    env: settings,
    fetch: p.fetch,
    sleep: async () => {},
  });
}

test("preview matches the canonical initial definitions without reading credentials or fetching", async () => {
  const manifest = buildManifest({
    environment: args.environment,
    datasetId: "sole-staging",
    activatedAt: args.at,
    schemaVersion: 2,
    financialSource: "warehouse",
    behaviorArchiveCutoff: null,
  });
  const preview = await provisionAnalytics({
    ...args,
    env: new Proxy({}, { get: () => assert.fail("dry run read credentials") }),
    fetch: () => assert.fail("dry run accessed network"),
  });
  assert.equal(preview.mode, "dry-run");
  assert.deepEqual(preview.manifest, manifest);
  assert.equal(manifest.endpoints.length, 22);
  assert.ok(manifest.endpoints.every((endpoint) => endpoint.version === 1));
  const variables = new Map(preview.variables.map((v) => [v.name, v]));
  for (const endpoint of manifest.endpoints) {
    const names = new Set(
      Array.from(endpoint.sql.matchAll(/\{variables\.(\w+)\}/g), (m) => m[1]),
    );
    assert.deepEqual(new Set(endpoint.variables.map((v) => v.code_name)), names);
    for (const name of names) assert.equal(variables.get(name)?.type, "String");
  }
  assert.equal(variables.get("dataset_id").default_value, "sole-unconfigured");
  assert.equal(variables.get("page_end").default_value, "0");
  assert.equal(
    variables.get("start_inclusive").default_value,
    variables.get("end_exclusive").default_value,
  );
  assert.match(variables.get("start_inclusive").default_value, /T00:00:00Z$/);
  assert.deepEqual(planProvisioning(args).manifest, manifest);
});

test("actual CLI dry run needs no credentials and rejects invalid calendar instants", () => {
  const run = (at) =>
    spawnSync(
      process.execPath,
      ["scripts/provision-admin-analytics.mjs", "--environment", "staging", "--at", at],
      { env: {}, encoding: "utf8", timeout: 15000 },
    );
  const valid = run(args.at);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).manifest.endpoints.length, 22);
  assert.equal(run("2026-02-30T00:00:00Z").status, 1);
});

test("writes once, binds server variable UUIDs and re-runs exactly across pagination", async () => {
  const p = provider();
  const first = await write(p);
  assert.equal(first.createdEndpoints, 22);
  assert.equal(first.verifiedEndpoints, 22);
  assert.equal(first.createdVariables, p.variables.size);
  assert.equal(p.writes.length, 22 + p.variables.size);
  assert.ok(
    p.reads.includes(base + "endpoints/sole_analytics_reconciliation_raw/?version=1"),
  );
  const before = p.writes.length;
  p.control.paginate = true;
  const second = await write(p);
  assert.equal(second.createdEndpoints, 0);
  assert.equal(second.createdVariables, 0);
  assert.equal(second.verifiedEndpoints, 22);
  assert.equal(p.writes.length, before);
  assert.ok(p.reads.includes(base + "insight_variables/?offset=3"));
});

test("foreign project, key reuse, foreign pagination and invalid variable type fail before writes", async () => {
  const p = provider();
  p.control.foreignProject = true;
  await assert.rejects(write(p), /pairing/);
  p.control.foreignProject = false;
  await assert.rejects(
    write(p, { ...env, POSTHOG_PROVISIONING_KEY: operatorKey }),
    /credential/,
  );
  for (const next of [
    "https://foreign.example" + base + "insight_variables/?offset=1",
    host + "/api/projects/502/insight_variables/?offset=1",
    host + base + "insight_variables/",
  ]) {
    p.control.next = next;
    await assert.rejects(write(p), /pagination/);
  }
  p.control.next = null;
  p.variables.set("dataset_id", {
    code_name: "dataset_id",
    id: "11a87d84-6ef4-4c36-8dfd-987654321000",
    type: "Boolean",
  });
  await assert.rejects(write(p), /variable/);
  assert.equal(p.writes.length, 0);
});

test("rejects oversize streamed JSON before entering the write phase", async () => {
  const p = provider();
  p.control.oversizedPage = true;
  await assert.rejects(write(p), (error) => {
    assert.match(error.message, /response size/);
    assert.doesNotMatch(error.message, new RegExp(canary));
    return true;
  });
  assert.equal(p.writes.length, 0);
});

test("existing query, pins and activity/materialization conflicts stay untouched", async () => {
  const p = provider();
  await write(p);
  p.writes.length = 0;
  const target = "sole_analytics_journey";
  const good = p.endpoints.get(target);
  for (const diff of [
    { query: { ...good.query, query: "SELECT 1" } },
    { query: { ...good.query, variables: {} } },
    { version: 2 },
    { is_active: false },
    { endpoint_is_active: false },
    { is_materialized: true },
    { materialization: { enabled: true } },
  ]) {
    p.endpoints.set(target, { ...good, ...diff });
    await assert.rejects(write(p), /definition/);
  }
  p.endpoints.set(target, good);
  p.control.currentVersion = 2;
  await assert.rejects(write(p), /definition/);
  assert.equal(p.writes.length, 0);
});

test("reconciles variable duplicates and ambiguous endpoint writes using GET only", async () => {
  for (const key of ["lostResponse", "endpointConflict"]) {
    const p = provider();
    p.control.variableConflict = true;
    p.control.pinnedDelayed = true;
    p.control[key] = true;
    assert.equal((await write(p)).verifiedEndpoints, 22);
    assert.equal(p.writes.length, 22 + p.variables.size);
  }
});

test("an unresolved write never triggers another POST or exposes response bodies", async () => {
  const p = provider();
  p.control.rejectWithoutWrite = true;
  await assert.rejects(write(p), (error) => {
    assert.match(error.message, /unconfirmed/);
    assert.doesNotMatch(error.stack, new RegExp(canary));
    return true;
  });
  assert.equal(p.writes.filter((r) => r.path.endsWith("/endpoints/")).length, 1);
});
