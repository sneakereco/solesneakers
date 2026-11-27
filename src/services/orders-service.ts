// src/services/orders-service.ts

import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { OrdersRepository } from "@/repositories/orders-repo";
import { OrderEventsRepository } from "@/repositories/order-events-repo";
import { OrderAccessTokenService } from "@/services/order-access-token-service";
import type { OrderStatusResponse } from "@/types/domain/checkout";
import { readOrderFinancialEvidence } from "@/Modules/Orders/Source/Features/OrderStatus/financial-evidence";
import { classifyObservedOrder } from "@/Modules/Checkout/Source/Features/Outcomes/outcome-contract";
import { readPurchasedLines } from "@/Modules/Orders/Source/Features/OrderStatus/purchased-lines";
import type { Tables } from "@/types/db/database.types";
import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { PICKUP_INSTRUCTIONS } from "@/config/pickup";

interface OrderEvent {
  type: string;
  message: string | null;
  created_at: string;
}

type OrderRow = Tables<"orders">;
function monetaryAmount(value: number | string | null) {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isSafeInteger(Math.round(amount * 100)) ||
    Math.round(amount * 100) / 100 !== amount
  )
    throw Error("Invalid order amount");
  return amount;
}

export class OrdersService {
  private ordersRepo: OrdersRepository;
  private orderEventsRepo: OrderEventsRepository;
  private adminOrdersRepo: OrdersRepository | null;
  private adminEventsRepo: OrderEventsRepository | null;
  private orderAccessTokens: OrderAccessTokenService | null;

  constructor(
    private readonly supabase: TypedSupabaseClient,
    private readonly adminSupabase?: AdminSupabaseClient,
  ) {
    this.ordersRepo = new OrdersRepository(supabase);
    this.orderEventsRepo = new OrderEventsRepository(supabase);
    this.adminOrdersRepo = adminSupabase ? new OrdersRepository(adminSupabase) : null;
    this.adminEventsRepo = adminSupabase
      ? new OrderEventsRepository(adminSupabase)
      : null;
    this.orderAccessTokens = adminSupabase
      ? new OrderAccessTokenService(adminSupabase)
      : null;
  }

  async getOrderStatus(
    orderId: string,
    userId: string | null,
    accessToken: string | null,
  ): Promise<OrderStatusResponse> {
    if (userId) {
      const order = await this.ordersRepo
        .getByIdAndUser(orderId, userId)
        .catch((error) => {
          if (!accessToken) throw error;
          return null;
        });
      if (order && order.id === orderId && order.user_id === userId) {
        const events = await this.orderEventsRepo.listByOrderId(orderId);
        return this.buildResponse(order, events, this.supabase);
      }
    }
    if (
      !accessToken ||
      !this.adminSupabase ||
      !this.adminOrdersRepo ||
      !this.adminEventsRepo ||
      !this.orderAccessTokens
    )
      throw new Error("Unauthorized");
    const grant = await this.orderAccessTokens.verifyToken({
      orderId,
      token: accessToken,
    });
    if (grant?.order_id !== orderId) throw new Error("Unauthorized");
    const order = await this.adminOrdersRepo.getById(orderId);
    if (!order || order.id !== orderId) throw new Error("Order not found");
    const events = await this.adminEventsRepo.listByOrderId(orderId);
    return this.buildResponse(order, events, this.adminSupabase);
  }

  private async buildResponse(
    authorized: OrderRow,
    events: OrderEvent[],
    client: TypedSupabaseClient,
  ): Promise<OrderStatusResponse> {
    const { order, financial } = await readOrderFinancialEvidence(
      authorized,
      this.adminSupabase,
    );
    const status = order.status ?? "pending";
    const total = monetaryAmount(order.total);
    const financialReview = Boolean(
      order.checkout_financial_review ||
        (financial.source === "ledger" && financial.snapshot.reviewReason),
    );
    const confirmed =
      classifyObservedOrder({
        id: order.id,
        status,
        total,
        financial,
        financialReview,
      }) === "confirmed";
    if (
      order.fulfillment !== null &&
      order.fulfillment !== "ship" &&
      order.fulfillment !== "pickup"
    )
      throw Error("Invalid order fulfillment");
    const pickupInstructions =
      order.fulfillment === "pickup"
        ? (order.pickup_instructions ?? PICKUP_INSTRUCTIONS.join("\n"))
        : null;

    const purchasedLines = await readPurchasedLines(
      {
        orderId: order.id,
        authorizedAccess: confirmed
          ? {
              orderId: order.id,
              status: order.status ?? "pending",
              financialReview,
            }
          : null,
      },
      client,
    );
    return {
      id: order.id,
      financialReview,
      financial,
      subtotal: monetaryAmount(order.subtotal),
      shipping: monetaryAmount(order.shipping),
      tax: monetaryAmount(order.tax_amount),
      total,
      purchasedLines,
      ...(purchasedLines ? { purchasedItems: purchasedLines } : {}),
      customerId: authorized.user_id,
      status: order.status ?? "pending",
      fulfillment: order.fulfillment,
      updatedAt: order.updated_at?.toString() ?? order.created_at?.toString() ?? "",
      events: events.map((event) => ({
        type: event.type,
        message: event.message ?? null,
        createdAt: event.created_at,
      })),
      pickupInstructions,
      supportEmail: SUPPORT_EMAIL,
    };
  }

  async listOrdersForUser(userId: string) {
    return this.ordersRepo.listOrdersForUser(userId);
  }

  async getOrderById(orderId: string) {
    return this.ordersRepo.getById(orderId);
  }

  async listOrders(params?: {
    status?: string[];
    fulfillment?: string;
    fulfillmentStatus?: string;
    limit?: number;
  }) {
    return this.ordersRepo.listOrders(params);
  }

  async listOrdersPaged(params?: {
    status?: string[];
    fulfillment?: string;
    fulfillmentStatus?: string;
    limit?: number;
    page?: number;
    incomplete?: boolean;
    includeAll?: boolean;
  }) {
    return this.ordersRepo.listOrdersPaged(params);
  }
}
