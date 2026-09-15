import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApi } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TagTaxonomyService } from "@/services/tag-taxonomy-service";

const updateSchema = z
  .object({
    canonicalLabel: z.string().trim().min(1).optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdminApi();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid size id" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.format() },
      { status: 400 },
    );
  }
  const supabase = await createSupabaseServerClient();
  const service = new TagTaxonomyService(supabase);
  const size = await service.updateSize(id, parsed.data);
  return NextResponse.json(size);
}
