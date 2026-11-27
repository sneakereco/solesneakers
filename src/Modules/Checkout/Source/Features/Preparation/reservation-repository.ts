import type { SourceContext } from "@/Modules/Analytics/Source/Features/CommerceFacts/source-context";
import { z } from "zod";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/db/database.types";
import type { ReserveCheckoutInput } from "@/repositories/checkout-reservation-repo";
import type { PrepareCheckoutRequestItem } from "@/lib/checkout/checkout-request";
import {
  inventoryConflict,
  PreparationChanged,
  PreparationRecoveryRequired,
  reserved,
  type ReservationDecision,
} from "./reservation-contract";

export class CheckoutPreparationRepository {
  constructor(private readonly db: TypedSupabaseClient) {}
  async reserveCheckout(
    input: ReserveCheckoutInput & { ownerBinding: string; otherGuestContexts?: string[] },
  ): Promise<ReservationDecision> {
    // Only the database clock sets hold expiry.
    const { expiresAt: _requestedExpiry, analyticsContext, ...snapshot } = input;
    const request = {
      ...snapshot,
      version: 2,
      action: "reserve",
      currency: "USD",
      pickupContact: input.pickupContact ?? null,
    };
    return this.decide(request, input.items, analyticsContext ?? null);
  }
  async rejectBeforeAttach(orderId: string, ownerBinding: string): Promise<boolean> {
    const { data, error } = await this.db.rpc("reject_checkout_quote_before_attach", {
      p_order_id: orderId,
      p_owner_binding: ownerBinding,
    });
    if (error) throw error;
    return z.boolean().parse(data);
  }
  async inspectUnavailable(
    tenantId: string,
    idempotencyKey: string,
    items: PrepareCheckoutRequestItem[],
    ownerBinding: string,
    otherGuestContexts: string[],
  ) {
    const decision = await this.decide(
      {
        version: 2,
        action: "inspect",
        tenantId,
        idempotencyKey,
        items,
        ownerBinding,
        ...(otherGuestContexts.length ? { otherGuestContexts } : {}),
      },
      items,
    );
    if (decision.kind !== "conflict") throw new Error("checkout_inspection_invalid");
    return decision.conflicts;
  }
  private async decide(
    request: Json,
    items: PrepareCheckoutRequestItem[],
    analyticsContext?: SourceContext | null,
  ): Promise<ReservationDecision> {
    const { data, error } =
      analyticsContext === undefined
        ? await this.db.rpc("reserve_checkout_inventory_v2", { p_request: request })
        : await this.db.rpc("reserve_checkout_inventory_v2_with_analytics", {
            p_request: request,
            p_analytics: analyticsContext,
          });
    if (!error) return reserved.parse(data);
    if (error.code === "PC410" && error.message === "checkout_recovery_required")
      throw new PreparationRecoveryRequired();
    if (error.code === "PC410" && error.message === "checkout_preparation_changed")
      throw new PreparationChanged();
    if (error.code !== "PC409" || error.message !== "checkout_inventory_conflict")
      throw error;
    const conflicts = z
      .array(inventoryConflict)
      .min(1)
      .max(10)
      .parse(JSON.parse(error.details));
    if (
      new Set(conflicts.map((c) => c.variantId)).size !== conflicts.length ||
      conflicts.some(
        (c) =>
          !items.some(
            (i) =>
              i.variantId === c.variantId &&
              i.productId === c.productId &&
              i.quantity === c.requestedQuantity,
          ),
      )
    )
      throw new Error("checkout_conflict_invalid");
    return { kind: "conflict", conflicts };
  }
}
