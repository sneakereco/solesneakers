import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { StoreAccessSettingsService } from "@/services/store-access-settings-service";

export const CHECKOUT_UNAVAILABLE_MESSAGE = "Online checkout is temporarily unavailable.";

export type CheckoutAccessDecision = { open: true } | { open: false; message: string };

export async function assertCheckoutOpen(
  tenantId: string,
): Promise<CheckoutAccessDecision> {
  try {
    const supabase = createSupabaseAdminClient();
    const service = new StoreAccessSettingsService(supabase);
    const settings = await service.getSettings(tenantId);

    if (service.isCheckoutLocked(settings)) {
      return {
        open: false,
        message: settings.checkoutLockMessage.trim() || CHECKOUT_UNAVAILABLE_MESSAGE,
      };
    }

    return { open: true };
  } catch {
    return { open: false, message: CHECKOUT_UNAVAILABLE_MESSAGE };
  }
}
