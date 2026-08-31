import type { Json } from "@/types/db/database.types";

export type CheckoutNotification = {
  id: string;
  orderId: string;
  kind: "order_confirmation" | "refund_confirmation";
  payload: Json;
};

export type CheckoutNotificationWorkerDependencies = {
  claim(limit: number): Promise<CheckoutNotification[]>;
  send(notification: CheckoutNotification): Promise<void>;
  markSent(id: string): Promise<void>;
  markFailed(id: string): Promise<void>;
};

export async function processCheckoutNotifications(
  deps: CheckoutNotificationWorkerDependencies,
  limit: number,
): Promise<{ claimed: number; sent: number; failed: number }> {
  const notifications = await deps.claim(limit);
  let sent = 0;
  let failed = 0;

  for (const notification of notifications) {
    try {
      await deps.send(notification);
      await deps.markSent(notification.id);
      sent += 1;
    } catch {
      await deps.markFailed(notification.id);
      failed += 1;
    }
  }

  return { claimed: notifications.length, sent, failed };
}
