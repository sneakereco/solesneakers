import { parseArgs } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { requireAnalytics } from "./analytics-operator-runtime.mjs";

const feature = (path) =>
  requireAnalytics("../src/Modules/Analytics/Source/Features/" + path + ".ts");
const { values } = parseArgs({
  options: {
    environment: { type: "string" },
    source: { type: "string" },
    attestation: { type: "string" },
  },
});
let budget;
try {
  const { environment, source } = values;
  if (
    !["staging", "production"].includes(environment) ||
    !["warehouse", "native"].includes(source)
  )
    throw Error();
  const config = await feature("Configuration/operator-pairing").pairOwnerProject(
    process.env,
    environment,
  );
  const dataset = "sole-" + environment;
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
      },
    },
  );
  const rpc = async (name, args = {}) => {
    const { data, error } = await db.rpc(name, { p_dataset_id: dataset, ...args });
    if (error) throw Error("Source unavailable");
    return data;
  };
  const { createObservationQueryBudget } = feature("Reporting/report-cache");
  const { executePostHogQuery, WAREHOUSE_OBSERVATION_EXECUTION } = feature(
    "Reporting/posthog-query",
  );
  const deadline = performance.now() + 20000;
  let exhaustedBytes = false;
  let remaining = 16 * 1024 * 1024;
  const boundedFetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok || !response.body) return response;
    let bytes = 0;
    const stream = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          remaining -= chunk.byteLength;
          if (bytes > 8 * 1024 * 1024 || remaining < 0) {
            exhaustedBytes = true;
            controller.error(new Error("Observation size limit"));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(stream, { status: response.status, headers: response.headers });
  };
  budget = createObservationQueryBudget(
    {
      project: config.apiHost + "/" + config.projectId,
      store: feature("Reporting/report-store").createReportStore(),
      execute: (q, timeoutMs) =>
        executePostHogQuery(q, {
          config,
          timeoutMs,
          now: () => new Date(),
          fetch: boundedFetch,
          mode: source === "warehouse" ? WAREHOUSE_OBSERVATION_EXECUTION : undefined,
        }),
    },
    deadline,
  );
  const read = (definition, variables, limit) =>
    budget.execute({
      endpoint: definition.name,
      version: definition.version,
      variables: { dataset_id: dataset, ...variables },
      limit,
      offset: 0,
    });
  const { financeObservation, linkObservation, nativeObservation, checkObservation } =
    feature("EventDelivery/observation-refresh");
  if (source === "warehouse") {
    const job = await rpc("analytics_refresh_claim");
    if (!job || !/^[a-f\d]{0,32}$/.test(job.prefix)) throw Error();
    const args = { p_token: job.token };
    let status = "retry",
      observedAt = null;
    try {
      const before = await rpc("analytics_refresh_snapshot", args);
      const sections = [
        ["finance", financeObservation],
        ["links", linkObservation],
      ];
      status = "matched";
      for (const [kind, definition] of sections) {
        if (before[kind].length > 500) {
          status = "split";
          break;
        }
        const wire = await read(definition, { prefix: job.prefix }, 501);
        status = checkObservation(before[kind], wire, kind);
        if (status !== "matched") break;
      }
      if (status === "matched") {
        const after = await rpc("analytics_refresh_snapshot", args);
        if (!sections.every(([key]) => isDeepStrictEqual(before[key], after[key])))
          status =
            job.prefix.length < 8 && sections.some(([key]) => before[key].length > 1)
              ? "split"
              : "retry";
        else observedAt = before.observedAt;
      }
    } catch {
      status = exhaustedBytes ? "split" : "retry";
    }
    if (
      !(await rpc("analytics_refresh_finish", {
        ...args,
        p_result: status,
        p_observed_at: observedAt,
      }))
    )
      throw Error();
    console.log(
      JSON.stringify({ environment, source, status, depth: job.prefix.length }),
    );
    if (status === "retry") process.exitCode = 1;
  } else {
    // Owned observation settings file contains only a project ID, dates and confirmations.
    const evidence = JSON.parse(readFileSync(values.attestation, "utf8"));

    if (
      evidence.projectId !== config.projectId ||
      evidence.environment !== environment ||
      evidence.region !== config.apiHost ||
      evidence.geoIpDisabled !== true ||
      evidence.sourceAndDefinitionsVerified !== true ||
      process.env.NEXT_PUBLIC_POSTHOG_ENABLED !== "true"
    )
      throw Error();
    const checked = new Date().toISOString();
    const { months, retainedFrom } = await feature(
      "Configuration/operator-pairing",
    ).readNativeRetention(config, process.env.POSTHOG_OPERATOR_API_KEY);
    if (
      !(await rpc("analytics_record_native_retention", {
        p_months: months,
        p_retained_from: retainedFrom,
        p_verified_at: checked,
      }))
    )
      throw Error("Native retention unavailable");
    const scope = {
      environment,
      datasetId: dataset,
      activatedAt: evidence.activationInstant,
      schemaVersion: 2,
      financialSource: "warehouse",
      behaviorArchiveCutoff: null,
    };
    const definition = nativeObservation(scope);
    const p = await rpc("analytics_native_probe");
    // Send only a newly issued marker. A later run may read it back; never synthesize an old receipt.
    const ageMs = Date.now() - Date.parse(p.last_at);
    if (ageMs >= -1000 && ageMs < 15000) {
      const result = await feature(
        "EventDelivery/posthog-capture",
      ).captureAvailabilityProbe(p.last_id, p.last_at, {
        config,
        now: () => new Date(),
        fetch,
      });
      if (result.status !== "accepted") throw Error();
    }
    const first = p.first_id ?? p.last_id,
      start = p.first_at ?? p.last_at;
    const data = await read(
      definition,
      {
        first_id: first,
        last_id: p.last_id,
        start_inclusive: start,
        end_exclusive: p.last_at,
      },
      1,
    );
    if (
      data.hasMore ||
      data.truncated ||
      data.columns.join(",") !== "visible_events,markers" ||
      data.results.length !== 1 ||
      !Number.isSafeInteger(data.results[0][0]) ||
      data.results[0][0] < 0 ||
      data.results[0][1] !== (p.first_id ? 2 : 1)
    )
      throw Error();
    if (!(await rpc("analytics_native_advance", { p_last_id: p.last_id }))) throw Error();
    console.log(
      JSON.stringify({
        environment,
        source,
        status: "markers-read-back",
        through: p.last_at,
      }),
    );
  }
} catch {
  console.error(
    "Observation unavailable. A later scheduled run can retry the finite proof.",
  );
  process.exitCode = 1;
} finally {
  await budget?.close();
}
