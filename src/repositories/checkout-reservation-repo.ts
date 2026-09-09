import { z } from "zod";

import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { SquareCheckoutOrder } from "@/lib/square/checkout-orders";
import type { ExpiredCheckout } from "@/lib/checkout/expire-checkout-reservations";
import type { Json } from "@/types/db/database.types";
import type {
  CheckoutBillingAddress,
  PaymentPermitRequest,
} from "@/lib/checkout/checkout-request";

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
  paymentMethod: PaymentPermitRequest["method"];
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
  billingAddress: CheckoutBillingAddress | null;
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
  squareOrderVersion?: number | null;
  squarePaymentLinkUrl: string | null;
  squarePaymentLinkDeletedAt: string | null;
  items: CheckoutReservationItem[];
};

export type PaymentCheckout = {
  orderId: string;
  tenantId: string;
  userId: string | null;
  guestEmail: string | null;
  cartHash: string;
  status: string;
  expiresAt: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  fulfillment: "ship" | "pickup";
  squareOrderId: string | null;
  squareOrderVersion: number | null;
  deviceSessionId: string;
  shippingAddress: ReserveCheckoutInput["shippingAddress"];
  billingAddress: Pick<
    CheckoutBillingAddress,
    "line1" | "line2" | "city" | "state" | "postalCode" | "country"
  > | null;
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
  square_order_version: z.number().int().nonnegative().nullable().optional(),
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
  square_order_id: z.string().min(1).nullable(),
  square_order_version: z.number().int().nonnegative().nullable(),
});

const paymentCheckoutSchema = z.object({
  order_billing: z
    .object({
      line1: z.string().min(1),
      line2: z.string().nullable(),
      city: z.string().min(1),
      state: z.string().regex(/^[A-Z]{2}$/),
      postal_code: z.string().regex(/^\d{5}(?:-\d{4})?$/),
      country: z.literal("US"),
    })
    .nullable(),
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  user_id: z.string().nullable(),
  guest_email: z.string().email().nullable(),
  cart_hash: z.string().min(1),
  status: z.string().min(1),
  expires_at: z.string().min(1),
  subtotal: z.number().nonnegative(),
  shipping: z.number().nonnegative(),
  tax_amount: z.number().nonnegative().nullable(),
  total: z.number().positive(),
  fulfillment: z.enum(["ship", "pickup"]),
  square_order_id: z.string().min(1).nullable(),
  square_order_version: z.number().int().nonnegative().nullable(),
  checkout_protection_evidence: z
    .object({
      device_session_id: z.string().min(1),
    })
    .passthrough(),
  order_shipping: z
    .object({
      name: z.string().min(1),
      phone: z.string().nullable(),
      line1: z.string().min(1),
      line2: z.string().nullable(),
      city: z.string().min(1),
      state: z.string().min(1),
      postal_code: z.string().min(1),
      country: z.literal("US"),
    })
    .nullable(),
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
      .select(
        "id, square_payment_link_id, square_payment_link_deleted_at, square_order_id, square_order_version",
      )
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
        squareOrderId: row.square_order_id,
        squareOrderVersion: row.square_order_version,
      }));
  }

  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<ExistingCheckout | null> {
    const { data, error } = await this.supabase
      .from("orders")
      .select(
        "id, cart_hash, status, expires_at, subtotal, shipping, tax_amount, total, fulfillment, guest_email, square_payment_link_id, square_order_id, square_order_version, square_payment_link_url, square_payment_link_deleted_at, order_items(product_id, variant_id, quantity, unit_price, unit_cost, line_total, variant_sku, product_name, brand, model, category, condition, size_label)",
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
      squareOrderVersion: parsed.data.square_order_version ?? null,
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

  async findPaymentCheckout(orderId: string): Promise<PaymentCheckout | null> {
    const { data, error } = await this.supabase
      .from("orders")
      .select(
        "id, tenant_id, user_id, guest_email, cart_hash, status, expires_at, subtotal, shipping, tax_amount, total, fulfillment, square_order_id, square_order_version, checkout_protection_evidence, order_shipping(name, phone, line1, line2, city, state, postal_code, country), order_billing(line1, line2, city, state, postal_code, country)",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    const parsed = paymentCheckoutSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error("checkout_payment_order_invalid");
    }
    const row = parsed.data;
    const address = row.order_shipping;
    return {
      orderId: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      guestEmail: row.guest_email,
      cartHash: row.cart_hash,
      status: row.status,
      expiresAt: row.expires_at,
      subtotalCents: dollarsToCents(row.subtotal),
      shippingCents: dollarsToCents(row.shipping),
      taxCents: dollarsToCents(row.tax_amount ?? 0),
      totalCents: dollarsToCents(row.total),
      fulfillment: row.fulfillment,
      squareOrderId: row.square_order_id,
      squareOrderVersion: row.square_order_version,
      deviceSessionId: row.checkout_protection_evidence.device_session_id,
      billingAddress: row.order_billing
        ? {
            line1: row.order_billing.line1,
            line2: row.order_billing.line2,
            city: row.order_billing.city,
            state: row.order_billing.state,
            postalCode: row.order_billing.postal_code,
            country: row.order_billing.country,
          }
        : null,
      shippingAddress: address
        ? {
            name: address.name,
            phone: address.phone,
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            state: address.state,
            postalCode: address.postal_code,
            country: address.country,
          }
        : null,
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
      p_payment_method: input.paymentMethod,
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
      p_billing_address: input.billingAddress
        ? {
            given_name: input.billingAddress.givenName,
            family_name: input.billingAddress.familyName,
            phone: input.billingAddress.phone ?? null,
            line1: input.billingAddress.line1,
            line2: input.billingAddress.line2 ?? null,
            city: input.billingAddress.city,
            state: input.billingAddress.state,
            postal_code: input.billingAddress.postalCode,
            country: input.billingAddress.country,
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

  async attachSquareOrder(orderId: string, order: SquareCheckoutOrder): Promise<void> {
    const { data, error } = await this.supabase.rpc("attach_square_checkout_order", {
      p_order_id: orderId,
      p_square_order_id: order.id,
      p_square_order_version: order.version,
      p_shipping_cents: order.shippingCents,
      p_tax_cents: order.taxCents,
      p_total_cents: order.totalCents,
      p_tax_calculation_id: order.taxCalculationId,
    });

    if (error) {
      throw error;
    }
    if (data !== true) {
      throw new Error("checkout_square_order_attach_failed");
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
