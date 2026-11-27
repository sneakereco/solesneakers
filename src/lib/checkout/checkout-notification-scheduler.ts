import { after } from "next/server";

import { createCheckoutMailDrainDependencies } from "@/lib/checkout/checkout-notification-dependencies";
import { recoverySettings } from "@/Modules/Checkout/Source/Features/Recovery/recovery-worker";
import { drainNotifications } from "@/Modules/Checkout/Source/Features/Recovery/notification-drain";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";

export function scheduleCheckoutNotifications(orderId: string): void {
  after(async () => {
    try {
      await drainNotifications(
        { ...recoverySettings, batchSize: 2 },
        createCheckoutMailDrainDependencies(createSupabaseAdminClient(), orderId),
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
