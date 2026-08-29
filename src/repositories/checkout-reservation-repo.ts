import { z } from "zod";

import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { HostedPaymentLink } from "@/lib/square/payment-links";
import type { ExpiredCheckout } from "@/lib/checkout/expire-checkout-reservations";
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
  taxCalculationId: string;
  customerState: string;
  shippingAddress: {
    name: string;
    phone?: string | null;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: "US";
  } | null;
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

export type ExistingCheckout = {
  orderId: string;
  cartHash: string;
  status: string;
  expiresAt: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  fulfillment: "ship" | "pickup";
  guestEmail: string | null;
  squarePaymentLinkId: string | null;
  squareOrderId: string | null;
  squarePaymentLinkUrl: string | null;
  squarePaymentLinkDeletedAt: string | null;
  items: CheckoutReservationItem[];
};

const reservationResultSchema = z.object({
  order_id: z.string().min(1),
  reused: z.boolean(),
  expires_at: z.string().min(1),
  square_payment_link_id: z.string().min(1).nullable().optional(),
  square_order_id: z.string().min(1).nullable().optional(),
  square_payment_link_url: z.string().url().nullable().optional(),
});

const existingCheckoutSchema = z.object({
  id: z.string().min(1),
  cart_hash: z.string().min(1),
  status: z.string().min(1),
  expires_at: z.string().min(1),
  subtotal: z.number().nonnegative(),
  shipping: z.number().nonnegative(),
  tax_amount: z.number().nonnegative().nullable(),
  total: z.number().positive(),
  fulfillment: z.enum(["ship", "pickup"]),
  guest_email: z.string().email().nullable(),
  square_payment_link_id: z.string().min(1).nullable(),
  square_order_id: z.string().min(1).nullable(),
  square_payment_link_url: z.string().url().nullable(),
  square_payment_link_deleted_at: z.string().nullable(),
  order_items: z.array(
    z.object({
      product_id: z.string().min(1),
      variant_id: z.string().min(1),
      quantity: z.number().int().positive(),
      unit_price: z.number().nonnegative(),
      unit_cost: z.number().nonnegative(),
      line_total: z.number().nonnegative(),
      variant_sku: z.string(),
      product_name: z.string(),
      brand: z.string(),
      model: z.string().nullable(),
      category: z.string(),
      condition: z.string(),
      size_label: z.string(),
    }),
  ),
});

const expiredCheckoutSchema = z.object({
  id: z.string().min(1),
  square_payment_link_id: z.string().min(1).nullable(),
  square_payment_link_deleted_at: z.string().nullable(),
});

function dollarsToCents(value: number): number {
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("checkout_existing_order_invalid");
  }
  return cents;
}

export class CheckoutReservationRepository {
  constructor(private readonly supabase: TypedSupabaseClient) {}

  async listExpired(nowIso: string, limit: number): Promise<ExpiredCheckout[]> {
    const { data, error } = await this.supabase
      .from("orders")
      .select("id, square_payment_link_id, square_payment_link_deleted_at")
      .eq("status", "pending")
      .lte("expires_at", nowIso)
      .order("expires_at", { ascending: true })
      .limit(Math.min(Math.max(limit, 1), 100));

    if (error) {
      throw error;
    }

    return z
      .array(expiredCheckoutSchema)
      .parse(data ?? [])
      .map((row) => ({
        orderId: row.id,
        squarePaymentLinkId: row.square_payment_link_id,
        squarePaymentLinkDeletedAt: row.square_payment_link_deleted_at,
      }));
  }

  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<ExistingCheckout | null> {
    const { data, error } = await this.supabase
      .from("orders")
      .select(
        "id, cart_hash, status, expires_at, subtotal, shipping, tax_amount, total, fulfillment, guest_email, square_payment_link_id, square_order_id, square_payment_link_url, square_payment_link_deleted_at, order_items(product_id, variant_id, quantity, unit_price, unit_cost, line_total, variant_sku, product_name, brand, model, category, condition, size_label)",
      )
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    const parsed = existingCheckoutSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error("checkout_existing_order_invalid");
    }

    return {
      orderId: parsed.data.id,
      cartHash: parsed.data.cart_hash,
      status: parsed.data.status,
      expiresAt: parsed.data.expires_at,
      subtotalCents: dollarsToCents(parsed.data.subtotal),
      shippingCents: dollarsToCents(parsed.data.shipping),
      taxCents: dollarsToCents(parsed.data.tax_amount ?? 0),
      totalCents: dollarsToCents(parsed.data.total),
      fulfillment: parsed.data.fulfillment,
      guestEmail: parsed.data.guest_email,
      squarePaymentLinkId: parsed.data.square_payment_link_id,
      squareOrderId: parsed.data.square_order_id,
      squarePaymentLinkUrl: parsed.data.square_payment_link_url,
      squarePaymentLinkDeletedAt: parsed.data.square_payment_link_deleted_at,
      items: parsed.data.order_items.map((item) => ({
        productId: item.product_id,
        variantId: item.variant_id,
        quantity: item.quantity,
        unitPriceCents: dollarsToCents(item.unit_price),
        unitCostCents: dollarsToCents(item.unit_cost),
        lineTotalCents: dollarsToCents(item.line_total),
        variantSku: item.variant_sku,
        productName: item.product_name,
        brand: item.brand,
        model: item.model,
        category: item.category,
        condition: item.condition,
        sizeLabel: item.size_label,
      })),
    };
  }

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
      p_tax_calculation_id: input.taxCalculationId,
      p_customer_state: input.customerState,
      p_shipping_address: input.shippingAddress
        ? {
            name: input.shippingAddress.name,
            phone: input.shippingAddress.phone ?? null,
            line1: input.shippingAddress.line1,
            line2: input.shippingAddress.line2 ?? null,
            city: input.shippingAddress.city,
            state: input.shippingAddress.state,
            postal_code: input.shippingAddress.postalCode,
            country: input.shippingAddress.country,
          }
        : null,
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
      p_shipping_cents: link.shippingCents,
      p_tax_cents: link.taxCents,
      p_total_cents: link.totalCents,
      p_tax_calculation_id: link.taxCalculationId,
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
