import { observeServerSession } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { OrderAccessTokenService } from "@/services/order-access-token-service";
import {
  classifyOriginalHold,
  readOriginalHold,
} from "@/Modules/Checkout/Source/Features/Preparation/read-original-hold";
import type { ValidationOrder } from "./validation-contract";

// These quantities are scoped to one already-prepared order. They are never free inventory.
export async function readOwnHolds(reference: ValidationOrder) {
  const session = await observeServerSession();
  const client = createSupabaseAdminClient();
  const order = await readOriginalHold(client, reference.orderId);
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
  const active = !!(await classifyOriginalHold(client, order));
  for (const h of order.inventory_reservations) {
    const previous = held.get(h.variant_id);
    held.set(h.variant_id, {
      quantity: (previous?.quantity ?? 0) + (active ? h.quantity : 0),
      recovery: !active,
    });
  }
  return held;
}
