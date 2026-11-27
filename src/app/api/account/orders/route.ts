// app/api/account/orders/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrdersService } from "@/services/orders-service";
import { AccountSessionError, requireAccountSession } from "@/lib/account/session";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { logError } from "@/lib/utils/log";

export async function GET(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    const session = await requireAccountSession(request, "read");
    const supabase = await createSupabaseServerClient();
    const service = new OrdersService(supabase);

    const orders = await service.listOrdersForUser(session.user.id);
    return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountSessionError) {
      return NextResponse.json(
        { error: error.message, requestId },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    logError(error, {
      layer: "api",
      message: "account_orders_error",
      requestId,
      route: "/api/account/orders",
    });
    return NextResponse.json(
      { error: "Failed to load orders", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
