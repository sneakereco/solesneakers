import { after } from "next/server";

import { createCheckoutNotificationDependencies } from "@/lib/checkout/checkout-notification-dependencies";
import { processCheckoutNotifications } from "@/lib/checkout/checkout-notification-worker";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";

export function scheduleCheckoutNotifications(orderId: string): void {
  after(async () => {
    try {
      await processCheckoutNotifications(
        createCheckoutNotificationDependencies(createSupabaseAdminClient(), orderId),
        2,
      );
    } catch (error) {
      logError(error, {
        layer: "job",
        orderId,
        event: "checkout_notification_prompt_delivery_failed",
      });
    }
  });
}
