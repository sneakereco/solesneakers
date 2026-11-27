import { readGuardedPaymentHistory } from "@/Modules/Orders/Source/Features/OrderStatus/financial-evidence";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import type { ExistingCheckout } from "@/repositories/checkout-reservation-repo";

export async function readOriginalHold(admin: AdminSupabaseClient, orderId: string) {
  const { data, error } = await admin
    .from("orders")
    .select(
      "id,tenant_id,user_id,checkout_guest_context_hash,status,expires_at,checkout_attempt_guarded,inventory_reservations(tenant_id,variant_id,quantity,status,expires_at),reservationCount:inventory_reservations(count)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function classifyOriginalHold(
  admin: AdminSupabaseClient,
  order: NonNullable<Awaited<ReturnType<typeof readOriginalHold>>>,
) {
  const now = Date.now();
  if (
    !order.checkout_attempt_guarded ||
    order.status !== "pending" ||
    !order.expires_at ||
    !(Date.parse(order.expires_at) > now) ||
    !order.inventory_reservations.length ||
    order.reservationCount[0]?.count !== order.inventory_reservations.length ||
    !order.inventory_reservations.every(
      (hold) =>
        hold.tenant_id === order.tenant_id &&
        hold.status === "active" &&
        Date.parse(hold.expires_at) > now,
    )
  )
    return null;
  return readGuardedPaymentHistory(order, admin);
}

export async function readOriginalRetryExpiration(
  admin: AdminSupabaseClient,
  tenantId: string,
  existing: ExistingCheckout,
) {
  const order = await readOriginalHold(admin, existing.orderId);
  if (
    !order ||
    order.tenant_id !== tenantId ||
    order.user_id !== existing.userId ||
    order.checkout_guest_context_hash !== existing.guestContextHash ||
    order.inventory_reservations.length !== existing.items.length ||
    !order.inventory_reservations.every((hold) =>
      existing.items.some(
        (line) => line.variantId === hold.variant_id && line.quantity === hold.quantity,
      ),
    ) ||
    (await classifyOriginalHold(admin, order)) !== "retry"
  )
    return null;
  return new Date(
    Math.min(
      Date.parse(existing.expiresAt),
      ...order.inventory_reservations.map((hold) => Date.parse(hold.expires_at)),
    ),
  ).toISOString();
}
