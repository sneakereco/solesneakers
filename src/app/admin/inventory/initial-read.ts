import { requireAdmin } from "@/lib/auth/session";
import { ensureTenantId } from "@/lib/auth/tenant";
import { withRequestDeadline } from "@/lib/http/request-deadline";
import {
  createSupabaseServerClient,
  type TypedSupabaseClient,
} from "@/lib/supabase/server";

export async function readInventoryData<T>(
  load: (
    supabase: TypedSupabaseClient,
    tenantId: string,
    signal: AbortSignal,
  ) => Promise<T>,
): Promise<T> {
  const session = await requireAdmin();
  return withRequestDeadline(async (signal) => {
    const supabase = await createSupabaseServerClient(signal);
    signal.throwIfAborted();
    const tenantId = await ensureTenantId(session, supabase);
    signal.throwIfAborted();
    return load(supabase, tenantId, signal);
  });
}
