import {
  assertCheckoutOpen,
  CHECKOUT_UNAVAILABLE_MESSAGE,
  type CheckoutAccessDecision,
} from "@/lib/checkout/checkout-access";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { TenantRepository } from "@/repositories/tenant-repo";

export async function loadCheckoutPageAccess(): Promise<CheckoutAccessDecision> {
  try {
    const tenantId = await new TenantRepository(
      createSupabaseAdminClient(),
    ).getFirstTenantId();
    if (!tenantId) {
      return { open: false, message: CHECKOUT_UNAVAILABLE_MESSAGE };
    }
    return assertCheckoutOpen(tenantId);
  } catch {
    return { open: false, message: CHECKOUT_UNAVAILABLE_MESSAGE };
  }
}
