import { observeCheckoutRequest } from "@/Modules/Checkout/Source/Features/Operations/request-metrics";
// src/app/api/orders/[orderId]/route.ts

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrdersService } from "@/services/orders-service";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { readCurrentPaymentAttempt } from "@/Modules/Checkout/Source/Features/Payments/attempt-repository";
import { CheckoutRecoveryRepository } from "@/Modules/Checkout/Source/Features/Recovery/recovery-repository";
import { logError } from "@/lib/utils/log";

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

  let correlatedOrderId: string | undefined;
  return observeCheckoutRequest(
    "/api/orders/:orderId",
    "GET",
    requestId,
    async () => {
      try {
        const { orderId } = await params;

        const paramsParsed = paramsSchema.safeParse({ orderId });
        if (!paramsParsed.success) {
          return json(
            { error: "Invalid order ID", issues: paramsParsed.error.format(), requestId },
            400,
          );
        }

        const tokenParam = request.nextUrl.searchParams.get("token");

        const queryParsed = querySchema.safeParse({
          token: tokenParam && tokenParam.trim().length > 0 ? tokenParam : undefined,
          reconcile: request.nextUrl.searchParams.get("reconcile") ?? undefined,
        });

        if (!queryParsed.success) {
          return json(
            { error: "Invalid query", issues: queryParsed.error.format(), requestId },
            400,
          );
        }

        const supabase = await createSupabaseServerClient();
        const auth = await supabase.auth.getUser().catch((error) => {
          if (!queryParsed.data.token) throw error;
          return null;
        });
        const user = auth?.data.user;
        const userId = user?.id ?? null;

        const accessToken = queryParsed.data.token ?? null;

        const adminSupabase = createSupabaseAdminClient();
        const ordersService = new OrdersService(supabase, adminSupabase);

        const status = await ordersService.getOrderStatus(
          paramsParsed.data.orderId,
          userId,
          accessToken,
        );

        correlatedOrderId = status.id;

        if (queryParsed.data.reconcile === "1" && status.status === "pending") {
          try {
            const attempt = await readCurrentPaymentAttempt(adminSupabase, orderId);
            if (attempt?.state === "ready") return json(status, 200);
            await new CheckoutRecoveryRepository(adminSupabase).enqueueRecovery({
              kind: "reconcile_payment",
              orderId,
              uniqueKey: attempt
                ? "payment_attempt:" + attempt.id
                : "legacy_payment_order:" + orderId,
              reason: "status_check",
              dueAt: new Date().toISOString(),
            });
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

        return json(status, 200);
      } catch (error: unknown) {
        if (
          !(
            error instanceof Error &&
            ["Unauthorized", "Order not found"].includes(error.message)
          )
        )
          logError(error, {
            layer: "api",
            requestId,
            route: "/api/orders/:orderId",
            orderId: correlatedOrderId,
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
    },
    () => correlatedOrderId,
  );
}

function json<T>(data: T, status: number) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
