// app/admin/inventory/create/actions.ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";
import { ensureTenantId } from "@/lib/auth/tenant";

export async function getFormInitialData() {
  const session = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const tenantId = await ensureTenantId(session, supabase);

  const taxonomyRepo = new TagTaxonomyRepository(supabase);

  const [brandsData, sizesData] = await Promise.all([
    taxonomyRepo.listBrands(tenantId),
    taxonomyRepo.listSizes(tenantId),
  ]);

  return {
    brands: brandsData.map((brand) => ({
      id: brand.id,
      label: brand.canonical_label,
    })),
    sizes: sizesData.map((size) => ({
      id: size.id,
      label: size.canonical_label,
      sizeType: size.size_type,
    })),
  };
}
