import { cpus, totalmem, freemem } from "node:os";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { redactArtifact } from "../shared/redact.mjs";
export async function readK6LiveCounters(baseUrl, fetcher = fetch) {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("k6 management must use an enrolled loopback endpoint");
  const response = await fetcher(new URL("/v1/metrics", url), {
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw Error("k6 live counters unavailable");
  const body = await response.json();
  if (!Array.isArray(body.data)) throw Error("Invalid k6 counter response");
  const values = new Map(
    body.data.map((metric) => [metric.id, metric.attributes?.sample]),
  );
  const attempts = values.get("technical_attempts")?.count,
    errors = values.get("technical_errors")?.count;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 0 ||
    !Number.isSafeInteger(errors) ||
    errors < 0 ||
    errors > attempts
  )
    throw Error("Exact k6 emergency counters unavailable");
  return {
    at: Date.now(),
    attempts,
    errors,
    requests: Math.max(attempts, values.get("http_reqs")?.count ?? 0),
    activeVUs: values.get("vus")?.value ?? null,
    bytesSent: values.get("data_sent")?.count ?? null,
    bytesReceived: values.get("data_received")?.count ?? null,
  };
}

export async function startTelemetry(plan, sources) {
  const samples = [],
    availability = {},
    timers = [],
    inFlight = new Set();
  let stopped = false;
  async function read(source, entry) {
    const started = performance.now();
    try {
      const value = await entry.read(plan);
      samples.push({
        source,
        at: Date.now(),
        value: redactArtifact(value),
        overheadMs: performance.now() - started,
      });
      availability[source] = { status: "available" };
    } catch {
      samples.push({
        source,
        at: Date.now(),
        value: { error: "Telemetry source unavailable" },
        overheadMs: performance.now() - started,
      });
      availability[source] = {
        status: "unavailable",
        reason: "Source could not be read",
      };
    }
  }
  for (const [source, entry] of Object.entries(sources)) {
    if (!entry || typeof entry.read !== "function") {
      availability[source] = { status: "unavailable", reason: "No collector configured" };
      continue;
    }
    await read(source, entry);
    const timer = setInterval(
      () => {
        if (stopped || [...inFlight].some((x) => x.source === source)) return;
        const work = { source, promise: null };
        work.promise = read(source, entry).finally(() => inFlight.delete(work));
        inFlight.add(work);
      },
      Math.max(1000, entry.intervalMs ?? 10000),
    );
    timer.unref();
    timers.push(timer);
  }
  return {
    async stop() {
      stopped = true;
      timers.forEach(clearInterval);
      await Promise.all([...inFlight].map((x) => x.promise));
      for (const entry of Object.values(sources)) entry?.close?.();
      return { runId: plan.runId, availability, samples };
    },
  };
}
export function parsePrometheus(text) {
  const samples = [];
  for (const line of text.split("\n")) {
    const match =
      /^([a-zA-Z_:][\w:]*)(?:\{([^}]*)\})?\s+(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:\s+\d+)?$/.exec(
        line,
      );
    if (!match || !Number.isFinite(Number(match[3]))) continue;
    const labels = {};
    for (const label of (match[2] ?? "").matchAll(/(cpu|mode|state)="([\w.-]+)"/g))
      labels[label[1]] = label[2];
    samples.push({ name: match[1], labels, value: Number(match[3]) });
  }
  return samples;
}
export async function collectDatabaseSnapshot(db) {
  const started = performance.now();
  const { rows } = await db.query(
    `select (select count(*)::int from pg_stat_activity where datname=current_database()) connections,current_setting('max_connections')::int max_connections,(select count(*)::int from pg_locks where not granted) waiting_locks`,
  );
  return {
    connections: rows[0].connections,
    maxConnections: rows[0].max_connections,
    waitingLocks: rows[0].waiting_locks,
    probeLatencyMs: performance.now() - started,
  };
}
export function createGeneratorCollector(networkReader) {
  let previous = cpus().map((cpu) => cpu.times);
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  return {
    intervalMs: 5000,
    async read() {
      const current = cpus().map((cpu) => cpu.times);
      let idle = 0,
        total = 0;
      for (let index = 0; index < current.length; index++) {
        for (const key of Object.keys(current[index]))
          total += current[index][key] - (previous[index]?.[key] ?? 0);
        idle += current[index].idle - (previous[index]?.idle ?? 0);
      }
      previous = current;
      const network = networkReader
        ? await networkReader()
        : { available: false, reason: "Network headroom collector is not configured" };
      return {
        cpuPercent: total ? 100 * (1 - idle / total) : null,
        memoryPercent: 100 * (1 - freemem() / totalmem()),
        operatorRssBytes: process.memoryUsage().rss,
        eventLoopP99Ms: lag.percentile(99) / 1e6,
        network,
        ...(typeof network.saturated === "boolean"
          ? { networkSaturated: network.saturated }
          : {}),
      };
    },
    close() {
      lag.disable();
    },
  };
}
export function createSupabaseMetricsCollector(target, secret, fetcher = fetch) {
  let previous;
  return {
    intervalMs: 60000,
    async read() {
      const response = await fetcher(
        `${target.resources.supabase.url}/customer/v1/privileged/metrics`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`service_role:${secret}`).toString("base64")}`,
          },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw Error("Supabase metrics unavailable");
      const series = parsePrometheus(await response.text()),
        cpu = series.filter((x) => x.name === "node_cpu_seconds_total");
      let cpuPercent = null;
      if (previous && cpu.length) {
        const prior = new Map(previous.map((x) => [JSON.stringify(x.labels), x.value]));
        let total = 0,
          idle = 0;
        for (const item of cpu) {
          const delta =
            item.value - (prior.get(JSON.stringify(item.labels)) ?? item.value);
          if (delta < 0) continue;
          total += delta;
          if (item.labels.mode === "idle") idle += delta;
        }
        if (total > 0) cpuPercent = 100 * (1 - idle / total);
      }
      previous = cpu;
      return {
        cpuPercent,
        seriesAvailable: series.length,
        cpuSeriesAvailable: cpu.length,
      };
    },
  };
}
export async function collectQueueSnapshot(db, variantIds) {
  const { rows } = await db.query(
    `with owned_orders as (select distinct order_id from public.order_items where variant_id=any($1::uuid[])) select (select count(*)::int from public.inventory_reservations r join owned_orders o on o.order_id=r.order_id where r.status='active') unresolved_holds,(select count(*)::int from public.orders p join owned_orders o on o.order_id=p.id where p.status='pending' and p.payment_transaction_id is not null) unresolved_payments,(select count(*)::int from public.checkout_notification_outbox n join owned_orders o on o.order_id=n.order_id where n.status in('pending','processing','failed')) notifications,(select coalesce(extract(epoch from now()-min(n.created_at)),0)::float from public.checkout_notification_outbox n join owned_orders o on o.order_id=n.order_id where n.status in('pending','processing','failed') and n.next_attempt_at<=now()) oldest_deliverable_seconds`,
    [variantIds],
  );
  const row = rows[0];
  return {
    unresolvedHolds: row.unresolved_holds,
    unresolvedPayments: row.unresolved_payments,
    notifications: row.notifications,
    oldestDeliverableSeconds: row.oldest_deliverable_seconds,
  };
}
