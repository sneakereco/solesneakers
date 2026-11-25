import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import type { TrustedOrderInput } from "./trusted-order-write";

export class OrderWriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class OrderWriteRepository {
  constructor(private readonly client: AdminSupabaseClient) {}

  async apply(input: TrustedOrderInput, actorId: string) {
    const { data, error } = await this.client
      .rpc("write_staff_order_fulfillment", {
        p_order_id: input.orderId,
        p_action: input.action,
        p_actor_id: actorId,
        p_carrier: input.carrier ?? undefined,
        p_tracking_number: input.trackingNumber ?? undefined,
      })
      .maybeSingle();
    if (error?.code === "22023") throw new OrderWriteError(error.message, 400);
    if (error?.code === "42501") throw new OrderWriteError("Forbidden", 403);
    if (error) throw error;
    if (!data) throw new OrderWriteError("Order not found", 404);
    return data;
  }
}
