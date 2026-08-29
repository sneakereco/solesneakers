import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/auth/session";
import { ensureTenantId } from "@/lib/auth/tenant";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logError } from "@/lib/utils/log";
import { checkoutSettingsSchema } from "@/lib/validation/admin";
import { CheckoutSettingsRepository } from "@/repositories/checkout-settings-repo";

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(new Headers(request.headers));

  try {
    const session = await requireAdminApi();
    const supabase = await createSupabaseServerClient();
    const tenantId = await ensureTenantId(session, supabase);
    const repository = new CheckoutSettingsRepository(supabase);
    const settings = await repository.getByTenant(tenantId);

    return NextResponse.json(
      { settings, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logError(error, {
      layer: "api",
      route: "/api/admin/checkout-settings",
      requestId,
    });
    return NextResponse.json(
      { error: "Failed to load checkout settings", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(new Headers(request.headers));

  try {
    const session = await requireAdminApi();
    const supabase = await createSupabaseServerClient();
    const tenantId = await ensureTenantId(session, supabase);
    const body = await request.json().catch(() => null);
    const parsed = checkoutSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", issues: parsed.error.format(), requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const repository = new CheckoutSettingsRepository(supabase);
    const settings = await repository.upsert(tenantId, parsed.data.flatShippingCents);

    return NextResponse.json(
      { settings, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logError(error, {
      layer: "api",
      route: "/api/admin/checkout-settings",
      requestId,
    });
    return NextResponse.json(
      { error: "Failed to save checkout settings", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
