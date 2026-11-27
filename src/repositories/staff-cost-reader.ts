import "server-only";
import { cookies } from "next/headers";
import { security } from "@/config/security";
import { requireAdminApi } from "@/lib/auth/session";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import {
  createSupabaseAdminClient,
  type AdminSupabaseClient,
} from "@/lib/supabase/service-role";

// The caller must first resolve IDs through its authenticated staff session query.
async function readCosts<T extends { id: string }>(
  ids: string[],
  read: (ids: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const unique = [...new Set(ids)];
  const costs = new Map<string, T>();
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    const { data, error } = await read(batch);
    if (error || !data) throw new Error("Staff cost lookup failed");
    for (const row of data) costs.set(row.id, row);
    if (batch.some((id) => !costs.has(id)))
      throw new Error("Incomplete staff cost lookup");
  }
  return (id: string) => {
    const row = costs.get(id);
    if (!row) throw new Error("Missing staff cost");
    return row;
  };
}

export function createStaffCostReader(client: TypedSupabaseClient) {
  let authorized: Promise<AdminSupabaseClient> | undefined;
  const authorize = async () => {
    const session = await requireAdminApi();
    const { verifyAdminSessionToken } = await import("@/lib/http/admin-session");
    const token = (await cookies()).get(security.proxy.adminSession.cookieName)?.value;
    if (!token || (await verifyAdminSessionToken(token))?.sub !== session.user.id)
      throw new Error("Staff session required");
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data || (data.nextLevel === "aal2" && data.currentLevel !== "aal2"))
      throw new Error("Staff session assurance unavailable");
    return createSupabaseAdminClient();
  };
  const db = () => (authorized ??= authorize());
  return {
    variants: (ids: string[]) =>
      readCosts(ids, async (batch) =>
        (await db())
          .from("product_variants")
          .select("id,unit_cost_cents,unit_cost_recorded")
          .in("id", batch),
      ),
    lines: (ids: string[]) =>
      readCosts(ids, async (batch) =>
        (await db()).from("order_items").select("id,unit_cost").in("id", batch),
      ),
  };
}
export type StaffCostReader = ReturnType<typeof createStaffCostReader>;
