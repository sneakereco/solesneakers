import { withRequestDeadline } from "@/lib/http/request-deadline";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { StoreAccessSettingsRepository } from "@/repositories/store-access-settings-repo";
import { StoreAccessSettingsService } from "@/services/store-access-settings-service";

type Snapshot = Awaited<
  ReturnType<StoreAccessSettingsRepository["getFirstTenantSettings"]>
>;
// Only public presentation uses this short snapshot. Checkout and claim writes
// keep their fresh access checks. Never serve an expired snapshot after failure.
const SNAPSHOT_TTL_MS = 2000;
let snapshot: { value: Snapshot; expiresAt: number } | undefined;
let pending: Promise<Snapshot> | undefined;

function readFreshSnapshot() {
  return withRequestDeadline((signal) =>
    new StoreAccessSettingsRepository(createSupabaseAdminClient()).getFirstTenantSettings(
      signal,
    ),
  );
}

async function readSnapshot(): Promise<Snapshot> {
  if (snapshot && Date.now() < snapshot.expiresAt) return snapshot.value;
  if (!pending) {
    pending = readFreshSnapshot()
      .then((value) => {
        snapshot = { value, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}

export async function getStoreAccessSettings({ fresh = true } = {}) {
  const access = await (fresh ? readFreshSnapshot() : readSnapshot());
  if (!access) return null;

  const service = new StoreAccessSettingsService(createSupabaseAdminClient());
  return {
    ...access,
    // Reevaluate time even while the raw configuration is cached, so an opening
    // happens at the scheduled second rather than at the next cache refresh.
    isSiteLocked: service.isSiteLocked(access.settings),
  };
}
