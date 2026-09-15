// app/admin/inventory/[id]/edit/actions.ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";
import { ProductService } from "@/services/product-service";
import { ensureTenantId } from "@/lib/auth/tenant";

export async function getEditFormInitialData(productId: string) {
  try {
    const session = await requireAdmin();
    const supabase = await createSupabaseServerClient();
    const tenantId = await ensureTenantId(session, supabase);

    const productService = new ProductService(supabase);
    const taxonomyRepo = new TagTaxonomyRepository(supabase);

    const [product, brandsData, modelsData, sizesData] = await Promise.all([
      productService.getProductById(productId, {
        tenantId,
        includeOutOfStock: true,
        includeUnpublished: true,
        archivedStatus: "all",
      }),
      taxonomyRepo.listBrands(tenantId),
      taxonomyRepo.listModels(tenantId),
      taxonomyRepo.listSizes(tenantId),
    ]);

    if (product && !brandsData.some((brand) => brand.id === product.brand.id)) {
      brandsData.push({
        ...(await taxonomyRepo.getBrandById(product.brand.id))!,
      });
    }
    if (product?.model && !modelsData.some((model) => model.id === product.model?.id)) {
      const selectedModel = await taxonomyRepo.getModelById(product.model.id);
      if (selectedModel) {
        modelsData.push(selectedModel);
      }
    }
    if (product) {
      for (const variant of product.variants) {
        if (sizesData.some((size) => size.id === variant.size.id)) {
          continue;
        }
        const selectedSize = await taxonomyRepo.getSizeById(variant.size.id);
        if (selectedSize) {
          sizesData.push(selectedSize);
        }
      }
    }

    return {
      product,
      brands: brandsData.map((brand: { id: string; canonical_label: string }) => ({
        id: brand.id,
        label: brand.canonical_label,
      })),
      models: modelsData.map((model) => ({
        id: model.id,
        label: model.canonical_label,
      })),
      sizes: sizesData.map((size) => ({
        id: size.id,
        label: size.canonical_label,
        sizeType: size.size_type,
      })),
    };
  } catch (error) {
    console.error("[getEditFormInitialData] Error:", error);
    throw error; // Re-throw so Next.js shows proper error
  }
}
