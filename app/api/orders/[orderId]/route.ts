// src/app/api/orders/[orderId]/route.ts
// DEBUGGING VERSION - Detailed logging at every step

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrdersService } from "@/services/orders-service";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { getSquareConfig } from "@/lib/square/config";
import { createSquareClient } from "@/lib/square/client";
import { SquarePaymentEventProcessor } from "@/lib/square/payment-event";
import { createSquarePaymentOrderVerifier } from "@/lib/square/payment-order-verification";
import { reconcilePendingSquarePayment } from "@/lib/square/payment-reconciliation";
import { createSquarePaymentReconciliationCooldown } from "@/lib/square/payment-reconciliation-cooldown";
import {
  createSquareShippingSyncDependencies,
  synchronizeSquareShippingAddress,
} from "@/lib/square/shipping-address-sync";
import { log, logError } from "@/lib/utils/log";
import { OrdersRepository } from "@/repositories/orders-repo";

const paramsSchema = z.object({
  orderId: z.string().uuid(),
});

const querySchema = z
  .object({
    token: z.string().trim().min(1).optional(),
    reconcile: z.literal("1").optional(),
  })
  .strict();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const requestId = getRequestIdFromHeaders(request.headers);

  log({
    level: "info",
    layer: "api",
    message: "order_status_request_start",
    requestId,
    url: request.url,
  });

  try {
    // Step 1: Resolve params
    log({
      level: "info",
      layer: "api",
      message: "order_status_resolving_params",
      requestId,
    });

    const resolvedParams = await params;
    const { orderId } = resolvedParams;

    log({
      level: "info",
      layer: "api",
      message: "order_status_params_resolved",
      requestId,
      orderId,
    });

    // Step 2: Validate params
    const paramsParsed = paramsSchema.safeParse({ orderId });
    if (!paramsParsed.success) {
      log({
        level: "error",
        layer: "api",
        message: "order_status_invalid_params",
        requestId,
        orderId,
        errors: paramsParsed.error.format(),
      });
      return json(
        { error: "Invalid order ID", issues: paramsParsed.error.format(), requestId },
        400,
      );
    }

    // Step 3: Get token from query
    const tokenParam = request.nextUrl.searchParams.get("token");
    log({
      level: "info",
      layer: "api",
      message: "order_status_token_check",
      requestId,
      orderId,
      hasTokenParam: Boolean(tokenParam),
      tokenLength: tokenParam?.length,
    });

    const queryParsed = querySchema.safeParse({
      token: tokenParam && tokenParam.trim().length > 0 ? tokenParam : undefined,
      reconcile: request.nextUrl.searchParams.get("reconcile") ?? undefined,
    });

    if (!queryParsed.success) {
      log({
        level: "error",
        layer: "api",
        message: "order_status_invalid_query",
        requestId,
        orderId,
        errors: queryParsed.error.format(),
      });
      return json(
        { error: "Invalid query", issues: queryParsed.error.format(), requestId },
        400,
      );
    }

    // Step 4: Get user session
    log({
      level: "info",
      layer: "api",
      message: "order_status_checking_auth",
      requestId,
      orderId,
    });

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    log({
      level: "info",
      layer: "api",
      message: "order_status_auth_checked",
      requestId,
      orderId,
      hasUser: Boolean(user),
      userId,
      userEmail: user?.email,
    });

    // Step 5: Get access token
    const accessToken = queryParsed.data.token ?? null;

    log({
      level: "info",
      layer: "api",
      message: "order_status_before_service_call",
      requestId,
      orderId,
      hasUserId: Boolean(userId),
      hasAccessToken: Boolean(accessToken),
      accessTokenLength: accessToken?.length,
    });

    // Step 6: Call service
    const adminSupabase = createSupabaseAdminClient();
    const ordersService = new OrdersService(supabase, adminSupabase);

    log({
      level: "info",
      layer: "api",
      message: "order_status_calling_service",
      requestId,
      orderId,
      userId,
      hasAccessToken: Boolean(accessToken),
    });

    let status = await ordersService.getOrderStatus(
      paramsParsed.data.orderId,
      userId,
      accessToken,
    );

    if (queryParsed.data.reconcile === "1" && status.status === "pending") {
      try {
        const acquired =
          await createSquarePaymentReconciliationCooldown().acquire(orderId);
        if (!acquired) {
          return json(status, 200);
        }
        const square = createSquareClient();
        const config = getSquareConfig();
        const processor = new SquarePaymentEventProcessor(
          adminSupabase,
          config.locationId,
          createSquarePaymentOrderVerifier(adminSupabase),
        );
        const orders = new OrdersRepository(adminSupabase);
        await reconcilePendingSquarePayment(orderId, {
          getLocalOrder: async (id) => {
            const order = await orders.getById(id);
            return order
              ? {
                  id: order.id,
                  status: order.status,
                  squareOrderId: order.square_order_id,
                }
              : null;
          },
          getSquareOrder: async (squareOrderId) => {
            const response = await square.orders.get({ orderId: squareOrderId });
            const order = response.order;
            return order?.id && order.locationId
              ? {
                  id: order.id,
                  locationId: order.locationId,
                  referenceId: order.referenceId ?? null,
                  tenders: (order.tenders ?? []).map((tender) => ({
                    paymentId: tender.paymentId ?? null,
                  })),
                }
              : null;
          },
          getSquarePayment: async (paymentId) => {
            const response = await square.payments.get({ paymentId });
            const payment = response.payment;
            const amount = payment?.amountMoney?.amount;
            if (
              !payment?.id ||
              !payment.orderId ||
              !payment.locationId ||
              !payment.status ||
              amount === null ||
              amount === undefined ||
              !payment.amountMoney?.currency ||
              !payment.createdAt ||
              !payment.versionToken
            ) {
              return null;
            }
            return {
              id: payment.id,
              orderId: payment.orderId,
              locationId: payment.locationId,
              status: payment.status,
              amountCents: Number(amount),
              currency: String(payment.amountMoney.currency),
              riskLevel: payment.riskEvaluation?.riskLevel
                ? String(payment.riskEvaluation.riskLevel)
                : null,
              createdAt: payment.createdAt,
              versionToken: payment.versionToken,
            };
          },
          processPayment: async (payment) => {
            await synchronizeSquareShippingAddress(
              {
                duplicate: false,
                fulfillmentAuthorized: false,
                orderId,
                paymentStatus: payment.paymentStatus,
                squareOrderId: payment.squareOrderId,
              },
              createSquareShippingSyncDependencies(adminSupabase),
            );
            return processor.processPaymentSnapshot(payment);
          },
        });
        status = await ordersService.getOrderStatus(orderId, userId, accessToken);
      } catch (reconciliationError) {
        logError(reconciliationError, {
          layer: "api",
          requestId,
          route: "/api/orders/:orderId",
          orderId,
          event: "square_payment_reconciliation_failed",
        });
      }
    }

    log({
      level: "info",
      layer: "api",
      message: "order_status_success",
      requestId,
      orderId,
      orderStatus: status.status,
      eventCount: status.events.length,
    });

    return json(status, 200);
  } catch (error: unknown) {
    log({
      level: "error",
      layer: "api",
      message: "order_status_error",
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    logError(error, {
      layer: "api",
      requestId,
      route: "/api/orders/:orderId",
      userId: null,
      method: "GET",
    });

    const message =
      error instanceof Error ? error.message : "Failed to fetch order status";

    if (message === "Unauthorized") {
      return json({ error: message, requestId }, 401);
    }

    if (message === "Order not found") {
      return json({ error: message, requestId }, 404);
    }

    return json({ error: "Failed to fetch order status", requestId }, 500);
  }
}

function json<T>(data: T, status: number) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
