import { log } from "@/lib/utils/log";
import { sanitizeLifecycleEvent } from "./lifecycle-event";

export async function observeCheckoutRequest<T extends Response>(
  route: string,
  method: string,
  requestId: string,
  handle: () => Promise<T>,
  orderId?: () => string | undefined,
): Promise<T> {
  const start = performance.now();
  let status = 500;
  try {
    const response = await handle();
    status = response.status;
    return response;
  } finally {
    log({
      level: "info",
      layer: "api",
      message: "checkout_request",
      route,
      method,
      requestId,
      orderId: orderId?.(),
      status,
      latencyMs: Math.round(performance.now() - start),
    });
  }
}

// Reduce a bounded observation window across all instances of a release. The
// correlation map is private to this reduction; its keys never become series labels.
export function summarizeCheckoutEvents(rows: Iterable<unknown>) {
  const samples = new Map<string, { durations: number[]; errors: number }>();
  const orders = new Map<string, number>();
  const statuses: Record<string, number> = {};
  const perimeter: Record<string, number> = {};
  const leases: Record<string, number> = {};
  const admission: Record<string, number> = {};
  let calls = 0,
    maxCallsPerOrder = 0;
  for (const row of rows) {
    const e = sanitizeLifecycleEvent(row);
    if (
      e.event === "checkout_request" &&
      e.route &&
      e.status !== undefined &&
      e.latency_ms !== undefined
    ) {
      const sample = samples.get(e.route) ?? { durations: [], errors: 0 };
      sample.durations.push(e.latency_ms);
      const label = e.route + "." + e.status;
      statuses[label] = (statuses[label] ?? 0) + 1;
      if (e.status >= 500) sample.errors++;
      samples.set(e.route, sample);
    }
    if (e.event === "checkout_lease" && e.outcome) {
      const label = (e.operation ?? "shared") + "." + e.outcome;
      leases[label] = (leases[label] ?? 0) + 1;
    }
    if (
      e.route &&
      [
        "rate_limit_exceeded",
        "rate_limit_outage",
        "rate_limit_missing_ip",
        "csrf_block",
        "bot_mitigation",
      ].includes(e.event)
    ) {
      const label = e.route + "." + e.event;
      perimeter[label] = (perimeter[label] ?? 0) + 1;
    }
    if (e.event === "checkout_gateway_call") {
      calls++;
      if (e.orderId) {
        const n = (orders.get(e.orderId) ?? 0) + 1;
        orders.set(e.orderId, n);
        maxCallsPerOrder = Math.max(maxCallsPerOrder, n);
      }
    }
    if (e.event === "checkout_admission" && e.operation && e.outcome) {
      const key = e.operation + "." + e.outcome;
      admission[key] = (admission[key] ?? 0) + 1;
    }
  }
  const requests: Record<
    string,
    { count: number; errors: number; p95Ms: number; p99Ms: number }
  > = {};
  for (const [route, { durations, errors }] of samples) {
    durations.sort((a, b) => a - b);
    const count = durations.length;
    requests[route] = {
      count,
      errors,
      p95Ms: durations[Math.ceil(0.95 * count) - 1],
      p99Ms: durations[Math.ceil(0.99 * count) - 1],
    };
  }
  return {
    requests,
    statuses,
    perimeter,
    leases,
    admission,
    gateway: { calls, distinctOrders: orders.size, maxCallsPerOrder },
  };
}
