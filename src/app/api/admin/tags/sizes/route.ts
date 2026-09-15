import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApi } from "@/lib/auth/session";
import { ensureTenantId } from "@/lib/auth/tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TagTaxonomyService } from "@/services/tag-taxonomy-service";

const sizeTypeSchema = z.enum(["shoe", "clothing", "custom", "none"]);
const createSchema = z
  .object({
    sizeType: sizeTypeSchema,
    canonicalLabel: z.string().trim().min(1),
    sortOrder: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  const session = await requireAdminApi();
  const supabase = await createSupabaseServerClient();
  const tenantId = await ensureTenantId(session, supabase);
  const sizeType = sizeTypeSchema
    .nullable()
    .safeParse(request.nextUrl.searchParams.get("sizeType"));
  if (!sizeType.success) {
    return NextResponse.json({ error: "Invalid size type" }, { status: 400 });
  }
  const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "1";
  const service = new TagTaxonomyService(supabase);
  const sizes = await service.listSizes(tenantId, sizeType.data, includeInactive);
  return NextResponse.json({ sizes }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await requireAdminApi();
  const supabase = await createSupabaseServerClient();
  const tenantId = await ensureTenantId(session, supabase);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.format() },
      { status: 400 },
    );
  }
  const service = new TagTaxonomyService(supabase);
  const size = await service.createSize({ tenantId, ...parsed.data });
  return NextResponse.json(size, { status: 201 });
}
