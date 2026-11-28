import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
const revisedNames = [
  "sole_analytics_acquisition",
  "sole_analytics_acquisition_series",
  "sole_analytics_active",
  "sole_analytics_discovery",
  "sole_analytics_discovery_series",
  "sole_analytics_inventory_demand",
  "sole_analytics_products",
  "sole_analytics_sessions",
  "sole_analytics_visitor_series",
];
const activeName = "sole_analytics_active";
const activeV1 = readFileSync(
  new URL("./fixtures/analytics-active-v1.sql", import.meta.url),
  "utf8",
)
  .replaceAll("\r\n", "\n")
  .replaceAll("'2026-11-27T18:00:00Z'", "'2026-12-01T12:00:00Z'");
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
  const history = new Map();
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
      writes.push({ method: init.method, path: url.pathname, body });
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
    if (init.method === "PATCH") {
      const body = JSON.parse(init.body);
      writes.push({ method: init.method, path: url.pathname, body });
      assert.deepEqual(Object.keys(body), ["query"]);
      const name = url.pathname.split("/").at(-2);
      const prior = endpoints.get(name);
      if (control.rejectPatchWithoutWrite) return no(409);
      history.set(name + ":" + prior.version, prior);
      const version = prior.version + 1;
      const revised = {
        ...prior,
        version,
        version_id: "revised-version",
        query: { ...body.query, limit: null },
      };
      endpoints.set(name, revised);
      if (control.advanceAfterPatch)
        control.advanceOnPinned = { name, version, remainingReads: 1 };
      if (control.losePatchResponse) throw new Error(canary);
      return Response.json({ name, current_version: version });
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
    if (!url.search) {
      if (control.lagCurrent?.name === name && control.lagCurrent.afterPinned) {
        const { version } = control.lagCurrent;
        delete control.lagCurrent;
        return version === null
          ? no(404)
          : Response.json({ name, current_version: version });
      }
      return Response.json({
        name,
        current_version: control.currentVersion ?? endpoint.version,
      });
    }
    const version = Number(url.searchParams.get("version"));
    const pinned =
      version === endpoint.version ? endpoint : history.get(name + ":" + version);
    if (version === 2 && pinned?.version === version && control.lagCurrent?.name === name)
      control.lagCurrent.afterPinned = true;
    const advance = control.advanceOnPinned;
    if (
      pinned?.version === version &&
      advance?.name === name &&
      advance.version === version &&
      --advance.remainingReads === 0
    ) {
      history.set(name + ":" + version, pinned);
      endpoints.set(name, {
        ...pinned,
        version: version + 1,
        version_id: "concurrent-version",
      });
    }
    return pinned?.version === version ? Response.json(pinned) : no(404);
  };
  return { variables, endpoints, writes, reads, control, fetch };
}

function write(p, settings = env, scope = {}) {
  return provisionAnalytics({
    ...args,
    ...scope,
    write: true,
    env: settings,
    fetch: p.fetch,
    sleep: async () => {},
  });
}

function installLegacyActive(p) {
  const final = p.endpoints.get(activeName);
  const legacy = {
    ...final,
    version: 1,
    version_id: "legacy-version",
    query: { ...final.query, query: activeV1 },
  };
  p.endpoints.set(activeName, legacy);
  return legacy;
}

test("preview matches the canonical definitions without reading credentials or fetching", async () => {
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
  assert.deepEqual(
    manifest.endpoints
      .filter((endpoint) => endpoint.version === 2)
      .map(({ name }) => name)
      .sort(),
    revisedNames,
  );
  assert.equal(
    manifest.endpoints.filter((endpoint) => endpoint.version === 1).length,
    13,
  );
  const variables = new Map(preview.variables.map((v) => [v.name, v]));
  assert.equal(variables.size, 31);
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

test("fresh install seeds each v2, publishes its exact pinned definition and re-runs without writes", async () => {
  const p = provider();
  const scope = { archiveCutoff: "2026-12-01T00:00:00Z" };
  const expected = planProvisioning({ ...args, ...scope }).manifest;
  const first = await write(p, env, scope);
  assert.equal(first.createdEndpoints, 22);
  assert.equal(first.revisedEndpoints, 9);
  assert.equal(first.verifiedEndpoints, 22);
  assert.equal(first.createdVariables, p.variables.size);
  assert.equal(p.writes.length, 22 + 9 + p.variables.size);
  for (const { name, version, sql } of expected.endpoints) {
    const post = p.writes.find(
      ({ method, body }) => method === "POST" && body.name === name,
    );
    const endpoint = p.endpoints.get(name);
    assert.equal(endpoint.version, version);
    assert.equal(endpoint.query.query, sql);
    assert.deepEqual(endpoint.query.variables, post.body.query.variables);
    if (version === 2) {
      assert.match(post.body.query.query, /^-- .*bootstrap[^\n]*\n(?:SELECT|WITH)/i);
      assert.equal(
        post.body.query.query.slice(post.body.query.query.indexOf("\n") + 1),
        sql,
      );
      assert.ok(
        p.reads.indexOf(base + `endpoints/${name}/?version=1`) <
          p.reads.indexOf(base + `endpoints/${name}/?version=2`),
      );
    } else {
      assert.equal(post.body.query.query, sql);
    }
  }
  assert.ok(
    p.reads.includes(base + "endpoints/sole_analytics_reconciliation_raw/?version=1"),
  );
  const before = p.writes.length;
  p.control.paginate = true;
  const second = await write(p, env, scope);
  assert.equal(second.createdEndpoints, 0);
  assert.equal(second.revisedEndpoints, 0);
  assert.equal(second.createdVariables, 0);
  assert.equal(second.verifiedEndpoints, 22);
  assert.equal(p.writes.length, before);
  assert.ok(p.reads.includes(base + "insight_variables/?offset=3"));
});

test("publishes a known legacy definition once and preserves the executable v1 query and bindings", async () => {
  const p = provider();
  await write(p);
  const legacy = installLegacyActive(p);
  p.writes.length = 0;
  const result = await write(p);
  assert.equal(result.createdEndpoints, 0);
  assert.equal(result.revisedEndpoints, 1);
  assert.equal(result.verifiedEndpoints, 22);
  assert.deepEqual(
    p.writes.map(({ method, path }) => ({ method, path })),
    [{ method: "PATCH", path: base + "endpoints/" + activeName + "/" }],
  );
  const preserved = await p.fetch(
    host + base + "endpoints/" + activeName + "/?version=1",
    {
      method: "GET",
      headers: { Authorization: "Bearer " + provisionKey },
      redirect: "error",
      signal: new AbortController().signal,
    },
  );
  assert.equal(preserved.status, 200);
  assert.deepEqual(await preserved.json(), legacy);
  assert.equal(p.endpoints.get(activeName).version, 2);
});

test("preflight rejects unknown v1 SQL, wrong scopes and malformed legacy bindings before writes", async () => {
  const p = provider();
  await write(p);
  const legacy = installLegacyActive(p);
  p.endpoints.delete("sole_analytics_journey");
  p.writes.length = 0;
  const [id, binding] = Object.entries(legacy.query.variables)[0];
  for (const query of [
    { ...legacy.query, query: "SELECT 1" },
    {
      ...legacy.query,
      query: legacy.query.query.replaceAll("'sole-staging'", "'sole-production'"),
    },
    {
      ...legacy.query,
      query: legacy.query.query.replaceAll("'staging'", "'production'"),
    },
    {
      ...legacy.query,
      query: legacy.query.query.replaceAll(
        "'2026-12-01T12:00:00Z'",
        "'2026-11-27T18:00:00Z'",
      ),
    },
    {
      ...legacy.query,
      variables: {
        ...legacy.query.variables,
        [id]: { ...binding, value: "foreign-default" },
      },
    },
  ]) {
    p.endpoints.set(activeName, { ...legacy, query });
    await assert.rejects(write(p), /definition/);
    assert.equal(p.writes.length, 0);
  }
});

test("resumes an exact interrupted bootstrap seed and rejects malformed seed bindings", async () => {
  const p = provider();
  p.control.rejectPatchWithoutWrite = true;
  await assert.rejects(write(p), /unconfirmed/);
  assert.equal(p.writes.filter(({ method }) => method === "PATCH").length, 1);
  const seed = p.endpoints.get("sole_analytics_sessions");
  assert.equal(seed.version, 1);
  p.writes.length = 0;
  p.control.rejectPatchWithoutWrite = false;
  p.endpoints.set(seed.name, { ...seed, query: { ...seed.query, variables: {} } });
  await assert.rejects(write(p), /definition/);
  assert.equal(p.writes.length, 0);
  p.endpoints.set(seed.name, seed);
  assert.equal((await write(p)).verifiedEndpoints, 22);
  assert.equal(
    p.writes.filter(({ method, body }) => method === "POST" && body.name === seed.name)
      .length,
    0,
  );
  assert.equal(p.endpoints.get(seed.name).version, 2);
});

test("reconciles a lost PATCH acknowledgement without sending a duplicate PATCH", async () => {
  const p = provider();
  await write(p);
  installLegacyActive(p);
  p.writes.length = 0;
  p.reads.length = 0;
  p.control.losePatchResponse = true;
  const result = await write(p);
  assert.equal(result.revisedEndpoints, 0);
  assert.equal(result.verifiedEndpoints, 22);
  assert.equal(p.writes.length, 1);
  assert.equal(p.writes[0].method, "PATCH");
  assert.ok(p.reads.includes(base + "endpoints/" + activeName + "/?version=2"));
});

for (const [label, version] of [
  ["404", null],
  ["stale v1", 1],
]) {
  test(`retries the readback after a ${label} current version recheck without another PATCH`, async () => {
    const p = provider();
    await write(p);
    installLegacyActive(p);
    p.writes.length = 0;
    p.reads.length = 0;
    p.control.lagCurrent = { name: activeName, version };
    const result = await write(p);
    assert.equal(result.revisedEndpoints, 1);
    assert.equal(result.verifiedEndpoints, 22);
    assert.deepEqual(
      p.writes.map(({ method }) => method),
      ["PATCH"],
    );
    const pinnedV2 = base + "endpoints/" + activeName + "/?version=2";
    assert.equal(p.reads.filter((path) => path === pinnedV2).length, 2);
  });
}

test("rejects a concurrently published revision above the target after one PATCH", async () => {
  const p = provider();
  await write(p);
  installLegacyActive(p);
  p.writes.length = 0;
  p.control.advanceAfterPatch = true;
  await assert.rejects(write(p), /current PostHog Endpoint definition/);
  assert.deepEqual(
    p.writes.map(({ method }) => method),
    ["PATCH"],
  );
});

test("rejects v3 published during an already-v2 preflight pinned read without writing", async () => {
  const p = provider();
  await write(p);
  p.writes.length = 0;
  p.control.advanceOnPinned = { name: activeName, version: 2, remainingReads: 1 };
  await assert.rejects(write(p), /current PostHog Endpoint definition/);
  assert.equal(p.endpoints.get(activeName).version, 3);
  assert.equal(p.writes.length, 0);
});

test("rejects v2 published during the last legacy pinned read without PATCH", async () => {
  const p = provider();
  await write(p);
  installLegacyActive(p);
  p.writes.length = 0;
  p.control.advanceOnPinned = { name: activeName, version: 1, remainingReads: 2 };
  await assert.rejects(write(p), /current PostHog Endpoint definition/);
  assert.equal(p.writes.filter(({ method }) => method === "PATCH").length, 0);
  assert.equal(p.endpoints.get(activeName).version, 2);
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
    assert.equal(p.writes.length, 22 + 9 + p.variables.size);
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
