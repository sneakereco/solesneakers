import { z } from "zod";

import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { HostedPaymentLink } from "@/lib/square/payment-links";
import type { Json } from "@/types/db/database.types";

export type CheckoutReservationItem = {
  productId: string;
  variantId: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  lineTotalCents: number;
  variantSku: string;
  productName: string;
  brand: string;
  model: string | null;
  category: string;
  condition: string;
  sizeLabel: string;
};

export type ReserveCheckoutInput = {
  tenantId: string;
  userId: string | null;
  guestEmail: string | null;
  fulfillment: "ship" | "pickup";
  idempotencyKey: string;
  cartHash: string;
  expiresAt: Date;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  protectionEvidence: Json;
  items: CheckoutReservationItem[];
};

export type CheckoutReservationResult = {
  orderId: string;
  reused: boolean;
  expiresAt: string;
  squarePaymentLinkId: string | null;
  squareOrderId: string | null;
  squarePaymentLinkUrl: string | null;
};

const reservationResultSchema = z.object({
  order_id: z.string().min(1),
  reused: z.boolean(),
  expires_at: z.string().min(1),
  square_payment_link_id: z.string().min(1).nullable().optional(),
  square_order_id: z.string().min(1).nullable().optional(),
  square_payment_link_url: z.string().url().nullable().optional(),
});

export class CheckoutReservationRepository {
  constructor(private readonly supabase: TypedSupabaseClient) {}

  async reserve(input: ReserveCheckoutInput): Promise<CheckoutReservationResult> {
    const items: Json = input.items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      unit_cost_cents: item.unitCostCents,
      line_total_cents: item.lineTotalCents,
      variant_sku: item.variantSku,
      product_name: item.productName,
      brand: item.brand,
      model: item.model,
      category: item.category,
      condition: item.condition,
      size_label: item.sizeLabel,
    }));

    const { data, error } = await this.supabase.rpc("reserve_square_checkout_inventory", {
      p_tenant_id: input.tenantId,
      p_user_id: input.userId,
      p_guest_email: input.guestEmail,
      p_currency: "USD",
      p_fulfillment: input.fulfillment,
      p_idempotency_key: input.idempotencyKey,
      p_cart_hash: input.cartHash,
      p_expires_at: input.expiresAt.toISOString(),
      p_subtotal_cents: input.subtotalCents,
      p_shipping_cents: input.shippingCents,
      p_tax_cents: input.taxCents,
      p_total_cents: input.totalCents,
      p_items: items,
      p_protection_evidence: input.protectionEvidence,
    });

    if (error) {
      throw error;
    }

    const parsed = reservationResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error("checkout_reservation_invalid_response");
    }

    return {
      orderId: parsed.data.order_id,
      reused: parsed.data.reused,
      expiresAt: parsed.data.expires_at,
      squarePaymentLinkId: parsed.data.square_payment_link_id ?? null,
      squareOrderId: parsed.data.square_order_id ?? null,
      squarePaymentLinkUrl: parsed.data.square_payment_link_url ?? null,
    };
  }

  async attachPaymentLink(orderId: string, link: HostedPaymentLink): Promise<void> {
    const { data, error } = await this.supabase.rpc("attach_square_payment_link", {
      p_order_id: orderId,
      p_square_payment_link_id: link.id,
      p_square_order_id: link.orderId,
      p_square_payment_link_url: link.url,
    });

    if (error) {
      throw error;
    }
    if (data !== true) {
      throw new Error("checkout_payment_link_attach_failed");
    }
  }

  async markPaymentLinkDeleted(orderId: string, paymentLinkId: string): Promise<void> {
    const { data, error } = await this.supabase.rpc("mark_square_payment_link_deleted", {
      p_order_id: orderId,
      p_square_payment_link_id: paymentLinkId,
    });

    if (error) {
      throw error;
    }
    if (data !== true) {
      throw new Error("checkout_payment_link_delete_evidence_failed");
    }
  }

  async release(orderId: string, reason: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc(
      "release_square_checkout_reservation",
      {
        p_order_id: orderId,
        p_reason: reason,
      },
    );

    if (error) {
      throw error;
    }
    return data === true;
  }

  async consume(orderId: string, squarePaymentId: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc(
      "consume_square_checkout_reservation",
      {
        p_order_id: orderId,
        p_square_payment_id: squarePaymentId,
      },
    );

    if (error) {
      throw error;
    }
    return data === true;
  }
}
