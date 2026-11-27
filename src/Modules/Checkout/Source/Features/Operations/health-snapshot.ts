import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";

const count = z.number().int().nonnegative().safe();
const stamp = z.iso.datetime({ offset: true });
const orderAlerts = z.enum([
  "old_unknown",
  "old_pending",
  "overdue_hold",
  "overdue_recovery",
  "overdue_mail",
  "expired_lease",
]);
const dueAlertMs = 5 * 60000;
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
  oldestOrderBoundDueMs: count,
  alertOrderIds: z.partialRecord(orderAlerts, z.guid()),
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
  if (s.oldestDueMs > dueAlertMs) alerts.push("overdue_recovery");
  if (s.expiredHoldLagMs > 5 * minute) alerts.push("overdue_hold");
  if (s.webhookLagMs > 5 * minute) alerts.push("overdue_webhook");
  if (s.oldestNotificationMs > 10 * minute) alerts.push("overdue_mail");
  if (s.expiredLeases > 0) alerts.push("expired_lease");
  if (s.waitingLocks > 0 || s.activeConnections / s.maxConnections >= 0.8)
    alerts.push("database_pressure");
  return alerts;
}
// An older unbound inbox job can make the queue overdue by itself. Only attach
// a different local job when its own due time independently exceeds the threshold.
export function alertOrderReference(health: CheckoutHealth, alert: string) {
  if (alert === "manual_review") return health.reviewOrderId;
  if (alert === "overdue_recovery" && health.oldestOrderBoundDueMs <= dueAlertMs)
    return null;
  const key = orderAlerts.safeParse(alert);
  return key.success ? (health.alertOrderIds[key.data] ?? null) : null;
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
