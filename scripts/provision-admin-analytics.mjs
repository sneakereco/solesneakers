import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildManifest } from "./admin-analytics-manifest.mjs";
import { requireAnalytics } from "./analytics-operator-runtime.mjs";

const maxPageRows = 500;
const maxPages = 10;
const maxBodyBytes = 2 * 1024 * 1024;
const maxDurationMs = 300_000;
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const emptyWindow = "2000-01-01T00:00:00Z";
const variableDefaults = {
  activated_at: emptyWindow,
  as_of: emptyWindow,
  behavior_enabled: "no",
  behavior_end: emptyWindow,
  dataset_id: "sole-unconfigured",
  end_exclusive: emptyWindow,
  inventory_enabled: "no",
  page_start: "0",
  page_end: "0",
  start_inclusive: emptyWindow,
};

class ProvisionError extends Error {}
class ReadUnavailable extends ProvisionError {}

export function planProvisioning({ environment, at, archiveCutoff = null }) {
  try {
    if (!utc.test(at) || (archiveCutoff !== null && !utc.test(archiveCutoff)))
      throw Error();
    const manifest = buildManifest({
      environment,
      datasetId: "sole-" + environment,
      schemaVersion: 2,
      financialSource: "warehouse",
      activatedAt: at,
      behaviorArchiveCutoff: archiveCutoff,
    });
    const variables = new Map();
    for (const definition of manifest.endpoints) {
      if (definition.version !== 1) throw Error();
      for (const { code_name: name, type } of definition.variables) {
        if (type !== "String" || !/^[a-z][a-z\d_]*$/.test(name)) throw Error();
        variables.set(name, {
          name,
          type,
          default_value: Object.hasOwn(variableDefaults, name)
            ? variableDefaults[name]
            : "",
        });
      }
    }
    return { manifest, variables: [...variables.values()] };
  } catch {
    throw new ProvisionError(
      "Invalid initial analytics manifest or UTC activation instant.",
    );
  }
}

async function readJson(response) {
  if (!response.body || Number(response.headers.get("content-length")) > maxBodyBytes) {
    void response.body?.cancel().catch(() => {});
    throw new ProvisionError("Invalid PostHog response size.");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        void reader.cancel().catch(() => {});
        throw new ProvisionError("Invalid PostHog response size.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}

function boundedExchange(request) {
  const deadline = performance.now() + maxDurationMs;
  return async (url, init, readBody, maxMs) => {
    const remaining = Math.min(maxMs, Math.floor(deadline - performance.now()));
    if (remaining < 1)
      throw new ProvisionError("Analytics provisioning deadline expired.");
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ReadUnavailable("PostHog request unavailable."));
      }, remaining);
    });
    try {
      return await Promise.race([
        timeout,
        (async () => {
          const response = await request(url, {
            ...init,
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          });
          if (response.redirected || (response.status >= 300 && response.status < 400)) {
            void response.body?.cancel().catch(() => {});
            throw new ProvisionError("Unexpected PostHog redirect.");
          }
          if (response.ok && readBody)
            return { status: response.status, body: await readJson(response) };
          void response.body?.cancel().catch(() => {});
          return { status: response.status };
        })(),
      ]);
    } catch (error) {
      if (error instanceof ProvisionError) throw error;
      throw new ReadUnavailable("PostHog request unavailable.");
    } finally {
      clearTimeout(timer);
    }
  };
}

async function provisionInitial(plan, env, request, sleep) {
  const provisioningKey = env.POSTHOG_PROVISIONING_KEY ?? "";
  if (
    !/^phx_[a-z\d_-]{20,}$/i.test(provisioningKey) ||
    [env.POSTHOG_OPERATOR_API_KEY, env.POSTHOG_QUERY_API_KEY?.trim()].includes(
      provisioningKey,
    )
  )
    throw new ProvisionError(
      "A separate personal PostHog provisioning credential is required.",
    );

  const exchange = boundedExchange(request);
  const { pairOwnerProject } = requireAnalytics(
    "../src/Modules/Analytics/Source/Features/Configuration/operator-pairing.ts",
  );
  let config;
  try {
    config = await pairOwnerProject(
      env,
      plan.manifest.scope.environment,
      async (url, init) => {
        const { status, body } = await exchange(url, init, true, 8_000);
        return new Response(body === undefined ? null : JSON.stringify(body), { status });
      },
    );
  } catch {
    throw new ProvisionError("Owner project pairing unavailable.");
  }
  const project = new URL(`/api/projects/${config.projectId}/`, config.apiHost);
  const collection = new URL("insight_variables/", project);
  const wanted = new Map(plan.variables.map((variable) => [variable.name, variable]));
  const headers = { Authorization: "Bearer " + provisioningKey };

  const get = async (url, allowMissing = false) => {
    const { status, body } = await exchange(
      url.href,
      { headers, method: "GET" },
      true,
      8_000,
    );
    if (status === 404 && allowMissing) return null;
    if (status === 408 || status === 429 || status >= 500)
      throw new ReadUnavailable("PostHog read unavailable.");
    if (status !== 200 || !body || typeof body !== "object" || Array.isArray(body))
      throw new ProvisionError("PostHog read rejected or malformed.");
    return body;
  };
  const create = async (url, body, readBack) => {
    let acknowledged = false;
    try {
      const { status } = await exchange(
        url.href,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        false,
        20_000,
      );
      acknowledged = status === 201;
    } catch (error) {
      if (!(error instanceof ReadUnavailable)) throw error;
    }
    // A lost acknowledgement or duplicate can leave a committed definition.
    // Read the exact target with bounded retries and never repeat a POST here.
    for (const wait of [0, 500, 1_000]) {
      if (wait) await sleep(wait);
      try {
        const proof = await readBack();
        if (proof) return { acknowledged, proof };
      } catch (error) {
        if (!(error instanceof ReadUnavailable)) throw error;
      }
    }
    throw new ProvisionError(
      "PostHog create outcome unconfirmed. Inspect the project and re-run only after it settles.",
    );
  };

  async function listVariables() {
    const keys = new Set();
    const found = new Map();
    const ids = new Set();
    let url = collection;
    for (let page = 0; page < maxPages; page++) {
      if (
        url.origin !== collection.origin ||
        url.pathname !== collection.pathname ||
        url.username ||
        url.password ||
        url.hash ||
        url.href.length > 2048 ||
        keys.has(url.href)
      )
        throw new ProvisionError("Unexpected PostHog variable pagination.");
      keys.add(url.href);
      const { results, next } = await get(url);
      if (!Array.isArray(results) || results.length > maxPageRows)
        throw new ProvisionError("Invalid PostHog variable page.");
      for (const variable of results) {
        if (!variable || typeof variable.code_name !== "string")
          throw new ProvisionError("Invalid PostHog variable metadata.");
        const expect = wanted.get(variable.code_name);
        if (!expect) continue;
        if (
          typeof variable.id !== "string" ||
          !uuid.test(variable.id) ||
          variable.type !== expect.type ||
          variable.default_value !== expect.default_value ||
          found.has(variable.code_name) ||
          ids.has(variable.id)
        )
          throw new ProvisionError("Conflicting PostHog variable definition.");
        ids.add(variable.id);
        found.set(variable.code_name, variable.id);
      }
      if (next === null) return found;
      if (typeof next !== "string" || !next || next.length > 2048)
        throw new ProvisionError("Invalid PostHog variable pagination.");
      try {
        url = new URL(next, url);
      } catch {
        throw new ProvisionError("Invalid PostHog variable pagination.");
      }
    }
    throw new ProvisionError("PostHog variable pagination limit reached.");
  }

  function queryFor(definition, variables) {
    const bindings = {};
    for (const { code_name } of definition.variables) {
      const id = variables.get(code_name);
      if (!id)
        throw new ProvisionError("Conflicting PostHog Endpoint variable definition.");
      bindings[id] = {
        variableId: id,
        code_name,
        value: wanted.get(code_name).default_value,
      };
    }
    return { kind: "HogQLQuery", query: definition.sql, variables: bindings };
  }

  async function readEndpoint(definition, variables, awaitingCreate = false) {
    const url = new URL(`endpoints/${definition.name}/`, project);
    const current = await get(url, true);
    if (current === null) return null;
    if (
      current.name !== definition.name ||
      current.current_version !== definition.version
    )
      throw new ProvisionError("Conflicting current PostHog Endpoint definition.");
    url.searchParams.set("version", definition.version);
    const pinned = await get(url, true);
    if (pinned === null && awaitingCreate) return null;
    const expected = queryFor(definition, variables);
    const actual = pinned?.query;
    const bindings = actual?.variables;
    if (
      !pinned ||
      pinned.name !== definition.name ||
      pinned.version !== definition.version ||
      typeof pinned.version_id !== "string" ||
      !pinned.version_id ||
      pinned.is_active !== true ||
      pinned.endpoint_is_active !== true ||
      pinned.is_materialized !== false ||
      pinned.materialization?.enabled !== false ||
      actual?.kind !== expected.kind ||
      actual.query !== expected.query ||
      Object.keys(actual).some(
        (key) => !Object.hasOwn(expected, key) && actual[key] !== null,
      ) ||
      !bindings ||
      Object.keys(bindings).length !== Object.keys(expected.variables).length ||
      Object.entries(expected.variables).some(([id, variable]) => {
        const value = bindings[id];
        return (
          value?.variableId !== id ||
          value.code_name !== variable.code_name ||
          value.value !== variable.value ||
          (value.isNull ?? false) !== false ||
          Object.keys(value).some(
            (key) =>
              !Object.hasOwn(variable, key) && key !== "isNull" && value[key] !== null,
          )
        );
      })
    )
      throw new ProvisionError("Conflicting pinned PostHog Endpoint definition.");
    return true;
  }

  let variables = await listVariables();
  const missingEndpoints = [];
  for (const definition of plan.manifest.endpoints) {
    if (!(await readEndpoint(definition, variables))) missingEndpoints.push(definition);
  }
  let createdVariables = 0;
  let createdEndpoints = 0;
  for (const [name, body] of wanted) {
    if (variables.has(name)) continue;
    const { acknowledged, proof } = await create(collection, body, async () => {
      const reread = await listVariables();
      return reread.has(name) ? reread : null;
    });
    variables = proof;
    createdVariables += Number(acknowledged);
  }
  for (const definition of missingEndpoints) {
    const body = {
      name: definition.name,
      query: queryFor(definition, variables),
      is_active: true,
      is_materialized: false,
    };
    const { acknowledged } = await create(new URL("endpoints/", project), body, () =>
      readEndpoint(definition, variables, true),
    );
    createdEndpoints += Number(acknowledged);
  }
  return {
    mode: "write",
    environment: config.environment,
    createdVariables,
    createdEndpoints,
    verifiedVariables: wanted.size,
    verifiedEndpoints: plan.manifest.endpoints.length,
  };
}

export async function provisionAnalytics({
  environment,
  at,
  archiveCutoff,
  write = false,
  env = process.env,
  fetch: request = fetch,
  sleep = delay,
}) {
  const plan = planProvisioning({ environment, at, archiveCutoff });
  if (write !== true) return { mode: "dry-run", ...plan };
  try {
    return await provisionInitial(plan, env, request, sleep);
  } catch (error) {
    if (error instanceof ProvisionError) throw error;
    throw new ProvisionError("Analytics provisioning unavailable.");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({
      options: {
        environment: { type: "string" },
        at: { type: "string" },
        "archive-cutoff": { type: "string" },
        write: { type: "boolean" },
      },
    });
    const result = await provisionAnalytics({
      ...values,
      archiveCutoff: values["archive-cutoff"],
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      error instanceof ProvisionError
        ? error.message
        : "Invalid analytics provisioning arguments.",
    );
    process.exitCode = 1;
  }
}
