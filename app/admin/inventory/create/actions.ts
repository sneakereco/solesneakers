// app/admin/inventory/create/actions.ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";
import { ShippingDefaultsService } from "@/services/shipping-defaults-service";
import { ensureTenantId } from "@/lib/auth/tenant";

export async function getFormInitialData() {
  const session = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const tenantId = await ensureTenantId(session, supabase);

  const taxonomyRepo = new TagTaxonomyRepository(supabase);
  const shippingDefaultsService = new ShippingDefaultsService(supabase);

  // Fetch shipping defaults and brands in parallel using direct service calls
  const [shippingDefaults, brandsData, sizesData] = await Promise.all([
    shippingDefaultsService.list(tenantId),
    taxonomyRepo.listBrands(tenantId),
    taxonomyRepo.listSizes(tenantId),
  ]);

  return {
    shippingDefaults: shippingDefaults || [],
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
