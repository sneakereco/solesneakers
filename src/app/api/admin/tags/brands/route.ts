// app/api/admin/tags/brands/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminApi } from "@/lib/auth/session";
import { ensureTenantId } from "@/lib/auth/tenant";
import { TagTaxonomyService } from "@/services/tag-taxonomy-service";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { logError } from "@/lib/utils/log";

const querySchema = z.object({
  includeInactive: z.enum(["1"]).optional(),
});

const createBrandSchema = z
  .object({
    canonicalLabel: z.string().trim().min(1),
    isActive: z.boolean().optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    const session = await requireAdminApi();
    const supabase = await createSupabaseServerClient();
    const tenantId = await ensureTenantId(session, supabase);
    const parsed = querySchema.safeParse({
      includeInactive: request.nextUrl.searchParams.get("includeInactive") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query", issues: parsed.error.format(), requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const includeInactive = parsed.data.includeInactive === "1";
    const service = new TagTaxonomyService(supabase);
    const brands = await service.listBrands(tenantId, includeInactive);

    return NextResponse.json({ brands }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError(error, {
      layer: "api",
      requestId,
      route: "/api/admin/tags/brands",
    });
    return NextResponse.json(
      { error: "Failed to load brands", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    const session = await requireAdminApi();
    const supabase = await createSupabaseServerClient();
    const tenantId = await ensureTenantId(session, supabase);
    const body = await request.json().catch(() => null);
    const parsed = createBrandSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", issues: parsed.error.format(), requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const service = new TagTaxonomyService(supabase);
    const brand = await service.createBrand({
      tenantId,
      canonicalLabel: parsed.data.canonicalLabel,
      isActive: parsed.data.isActive ?? true,
    });

    return NextResponse.json(brand, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logError(error, {
      layer: "api",
      requestId,
      route: "/api/admin/tags/brands",
    });
    return NextResponse.json(
      { error: "Failed to create brand", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
