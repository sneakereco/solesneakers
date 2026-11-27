// app/api/admin/orders/[orderId]/pickup/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import {
  OrderWriteError,
  OrderWriteRepository,
} from "@/Modules/Orders/Source/Features/TrustedMutations/order-write-repository";
import { writeTrustedOrder } from "@/Modules/Orders/Source/Features/TrustedMutations/trusted-order-write";
import { AuthError, requireAdminApi } from "@/lib/auth/session";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { logError } from "@/lib/utils/log";

const paramsSchema = z.object({
  orderId: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    const session = await requireAdminApi();
    const { orderId } = await params;
    const paramsParsed = paramsSchema.safeParse({ orderId });
    if (!paramsParsed.success) {
      return NextResponse.json(
        { error: "Invalid params", issues: paramsParsed.error.format(), requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    await writeTrustedOrder(
      { orderId: paramsParsed.data.orderId, action: "pickup" },
      { userId: session.user.id, role: "admin" },
      new OrderWriteRepository(createSupabaseAdminClient()),
    );
    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError || error instanceof OrderWriteError) {
      return NextResponse.json(
        { error: error.message, requestId },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    logError(error, {
      layer: "api",
      requestId,
      route: "/api/admin/orders/:orderId/pickup",
    });
    return NextResponse.json(
      { error: "Failed to mark pickup complete", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
