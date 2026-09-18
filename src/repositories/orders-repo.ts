// src/repositories/orders-repo.ts

import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { Tables, TablesUpdate } from "@/types/db/database.types";

type OrderRow = Tables<"orders">;
type OrderUpdate = TablesUpdate<"orders">;

export class OrdersRepository {
  constructor(private readonly supabase: TypedSupabaseClient) {}

  async getById(orderId: string): Promise<OrderRow | null> {
    const { data, error } = await this.supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return data;
  }

  async getBySquareOrderId(squareOrderId: string): Promise<OrderRow | null> {
    const { data, error } = await this.supabase
      .from("orders")
      .select("*")
      .eq("square_order_id", squareOrderId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return data;
  }

  async getByIdAndUser(orderId: string, userId: string): Promise<OrderRow | null> {
    const { data, error } = await this.supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return data;
  }

  async updatePaymentTransactionId(
    orderId: string,
    paymentTransactionId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("orders")
      .update({ payment_transaction_id: paymentTransactionId })
      .eq("id", orderId);

    if (error) {
      throw error;
    }
  }

  async listOrders(params?: {
    status?: string[];
    fulfillment?: string;
    fulfillmentStatus?: string;
    limit?: number;
  }) {
    let query = this.supabase
      .from("orders")
      .select(
        "*, profiles!user_id(email), items:order_items(*, product:products(id, name, category, created_at, description, images:product_images(url, is_primary, sort_order)), variant:product_variants(id, sku, sale_price_cents, unit_cost_cents)), shipping:order_shipping(*)",
      )
      .order("created_at", { ascending: false });

    if (params?.status?.length) {
      query = query.in("status", params.status);
    }
    if (params?.fulfillment) {
      query = query.eq("fulfillment", params.fulfillment);
    }
    if (params?.fulfillmentStatus) {
      query = query.eq("fulfillment_status", params.fulfillmentStatus);
    }
    if (params?.limit) {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return data ?? [];
  }

  async listOrdersPaged(params?: {
    status?: string[];
    fulfillment?: string;
    fulfillmentStatus?: string;
    limit?: number;
    page?: number;
    /** Show incomplete orders: status='pending' and past their expiry window */
    incomplete?: boolean;
    /** Skip default filtering — return all statuses */
    includeAll?: boolean;
  }) {
    let query = this.supabase
      .from("orders")
      .select(
        "*, profiles!user_id(email), items:order_items(*, product:products(id, name, category, created_at, description, images:product_images(url, is_primary, sort_order)), variant:product_variants(id, sku, sale_price_cents, unit_cost_cents)), shipping:order_shipping(*), billing:order_billing(name, phone), payment:payment_transactions(payment_method, square_payment_id, card_type, card_last4)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (params?.incomplete) {
      // Incomplete = checkout started (pending) but payment window has expired
      query = query.eq("status", "pending").lt("expires_at", new Date().toISOString());
    } else if (params?.status?.length) {
      query = query.in("status", params.status);
    } else if (!params?.includeAll) {
      // Legacy default: exclude refunded orders from unfiltered queries
      query = query.neq("status", "refunded");
    }

    if (params?.fulfillment) {
      query = query.eq("fulfillment", params.fulfillment);
    }
    if (params?.fulfillmentStatus) {
      query = query.eq("fulfillment_status", params.fulfillmentStatus);
    }
    if (params?.limit) {
      const page = Math.max(params.page ?? 1, 1);
      const start = (page - 1) * params.limit;
      const end = start + params.limit - 1;
      query = query.range(start, end);
    }

    const { data, error, count } = await query;
    if (error) {
      throw error;
    }
    return { orders: data ?? [], count: count ?? 0 };
  }

  async listOrdersForUser(userId: string) {
    const { data, error } = await this.supabase
      .from("orders")
      .select(
        "*, items:order_items(*, product:products(id, name), variant:product_variants(id, sku, sale_price_cents))",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }
    return data ?? [];
  }

  async markRefunded(orderId: string, amount: number): Promise<OrderRow> {
    const { data, error } = await this.supabase
      .from("orders")
      .update({
        status: "refunded",
        refund_amount: amount,
        refunded_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data as OrderRow;
  }

  async setFulfillmentStatus(orderId: string, status: string): Promise<void> {
    const { error } = await this.supabase
      .from("orders")
      .update({ fulfillment_status: status })
      .eq("id", orderId);

    if (error) {
      throw error;
    }
  }

  async markFulfilled(
    orderId: string,
    input: { carrier?: string | null; trackingNumber?: string | null },
  ): Promise<OrderRow> {
    const { data, error } = await this.supabase
      .from("orders")
      .update({
        fulfillment_status: "shipped",
        shipping_carrier: input.carrier ?? null,
        tracking_number: input.trackingNumber ?? null,
        shipped_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data as OrderRow;
  }

  async markReadyToShip(
    orderId: string,
    input: {
      carrier?: string | null;
      trackingNumber?: string | null;
      labelUrl?: string | null;
      labelCreatedBy?: string | null;
      actualShippingCost?: number | null;
    },
  ): Promise<OrderRow> {
    const updateData: OrderUpdate = {
      fulfillment_status: "ready_to_ship",
      shipping_carrier: input.carrier ?? null,
      tracking_number: input.trackingNumber ?? null,
      shipped_at: null,
    };

    if (input.labelUrl) {
      updateData.label_url = input.labelUrl;
      updateData.label_created_at = new Date().toISOString();
    }

    if (input.labelCreatedBy) {
      updateData.label_created_by = input.labelCreatedBy;
    }

    if (input.actualShippingCost !== null && input.actualShippingCost !== undefined) {
      updateData.actual_shipping_cost_cents = input.actualShippingCost;
    }

    const { data, error } = await this.supabase
      .from("orders")
      .update(updateData)
      .eq("id", orderId)
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data as OrderRow;
  }
}
