// app/admin/inventory/create/actions.ts
"use server";

import { readInventoryData } from "../initial-read";

import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";

export async function getFormInitialData() {
  return readInventoryData(async (supabase, tenantId) => {
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
  });
}
