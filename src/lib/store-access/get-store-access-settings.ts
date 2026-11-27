import { withRequestDeadline } from "@/lib/http/request-deadline";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { TenantRepository } from "@/repositories/tenant-repo";
import { StoreAccessSettingsService } from "@/services/store-access-settings-service";

export async function getStoreAccessSettings() {
  return withRequestDeadline(async (signal) => {
    const supabase = createSupabaseAdminClient();
    const tenantRepo = new TenantRepository(supabase);
    const tenantId = await tenantRepo.getFirstTenantId();

    signal.throwIfAborted();
    if (!tenantId) {
      return null;
    }

    const service = new StoreAccessSettingsService(supabase);
    const settings = await service.getSettings(tenantId);

    return {
      tenantId,
      settings,
      isSiteLocked: service.isSiteLocked(settings),
    };
  });
}
