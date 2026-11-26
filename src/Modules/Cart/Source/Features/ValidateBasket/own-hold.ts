import { observeServerSession } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { OrderAccessTokenService } from "@/services/order-access-token-service";
import type { ValidationOrder } from "./validation-contract";

// These quantities are scoped to one already-prepared order. They are never free inventory.
export async function readOwnHolds(reference: ValidationOrder) {
  const session = await observeServerSession();
  const client = createSupabaseAdminClient();
  const { data: order, error } = await client
    .from("orders")
    .select(
      "user_id,status,expires_at,checkout_attempt_guarded,inventory_reservations(variant_id,quantity,status,expires_at),checkout_payment_attempts(state)",
    )
    .eq("id", reference.orderId)
    .maybeSingle();
  if (error) throw error;
  const held = new Map<string, { quantity: number; recovery: boolean }>();
  if (!order) return held;
  const authorized =
    order.user_id !== null
      ? session?.user.id === order.user_id
      : !session &&
        !!reference.guestAccessToken &&
        (await new OrderAccessTokenService(client).validateToken({
          orderId: reference.orderId,
          token: reference.guestAccessToken,
        }));
  if (!authorized) return held;
  const now = Date.now();
  const active =
    order.checkout_attempt_guarded &&
    order.status === "pending" &&
    !!order.expires_at &&
    Date.parse(order.expires_at) > now &&
    order.checkout_payment_attempts.every((a) => a.state === "ready");
  for (const h of order.inventory_reservations) {
    const usable = active && h.status === "active" && Date.parse(h.expires_at) > now;
    const previous = held.get(h.variant_id);
    held.set(h.variant_id, {
      quantity: (previous?.quantity ?? 0) + (usable ? h.quantity : 0),
      recovery: !!previous?.recovery || !usable,
    });
  }
  return held;
}
