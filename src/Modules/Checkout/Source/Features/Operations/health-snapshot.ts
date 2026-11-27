import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";

const count = z.number().int().nonnegative().safe();
const stamp = z.iso.datetime({ offset: true });
const schema = z.object({
  observedAt: stamp,
  recoveryLastSeenAt: stamp.nullable(),
  mailLastSeenAt: stamp.nullable(),
  oldestUnknownMs: count,
  oldestPendingMs: count,
  oldestDueMs: count,
  expiredHoldLagMs: count,
  oldestNotificationMs: count,
  webhookLagMs: count,
  queueDepth: count,
  notificationDepth: count,
  reviewCount: count,
  squareLeases: count,
  smtpLeases: count,
  shippoLeases: count,
  expiredLeases: count,
  activeConnections: count,
  maxConnections: count.positive(),
  waitingLocks: count,
  pauseNewCheckouts: z.boolean(),
  pausePaymentDispatch: z.boolean(),
  reviewOrderId: z.guid().nullable(),
});
export async function readCheckoutHealth(deps: { read(): Promise<unknown> }) {
  const input = schema.parse(await deps.read());
  const clocks = [input.recoveryLastSeenAt, input.mailLastSeenAt];
  const workerLastSeenAt = clocks.every((v): v is string => v !== null)
    ? new Date(Math.min(...clocks.map((v) => Date.parse(v)))).toISOString()
    : null;
  return { ...input, workerLastSeenAt };
}
export type CheckoutHealth = Awaited<ReturnType<typeof readCheckoutHealth>>;

// Initial local alert settings. Set deployment acceptance/cadence independently.
export function checkoutAlerts(s: CheckoutHealth) {
  const alerts: string[] = [];
  const minute = 60000;
  if (!s.workerLastSeenAt) alerts.push("missing_heartbeat");
  else if (Date.parse(s.observedAt) - Date.parse(s.workerLastSeenAt) > 10 * minute)
    alerts.push("stale_heartbeat");
  if (s.reviewCount > 0) alerts.push("manual_review");
  if (s.oldestUnknownMs > 10 * minute) alerts.push("old_unknown");
  if (s.oldestPendingMs > 15 * minute) alerts.push("old_pending");
  if (s.oldestDueMs > 5 * minute) alerts.push("overdue_recovery");
  if (s.expiredHoldLagMs > 5 * minute) alerts.push("overdue_hold");
  if (s.webhookLagMs > 5 * minute) alerts.push("overdue_webhook");
  if (s.oldestNotificationMs > 10 * minute) alerts.push("overdue_mail");
  if (s.expiredLeases > 0) alerts.push("expired_lease");
  if (s.waitingLocks > 0 || s.activeConnections / s.maxConnections >= 0.8)
    alerts.push("database_pressure");
  return alerts;
}
export async function readDatabaseCheckoutHealth(db: Pick<AdminSupabaseClient, "rpc">) {
  return readCheckoutHealth({
    async read() {
      const { error, data } = await db.rpc("read_checkout_health");
      if (error) throw Error("checkout_health_unavailable");
      return data;
    },
  });
}
export async function recordWorkerHeartbeat(
  db: Pick<AdminSupabaseClient, "rpc">,
  worker: "recovery" | "mail",
) {
  const { error } = await db.rpc("record_checkout_worker_heartbeat", {
    p_worker: worker,
  });
  if (error) throw Error("checkout_heartbeat_unavailable");
}
