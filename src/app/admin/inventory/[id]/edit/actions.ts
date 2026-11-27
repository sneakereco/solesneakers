// app/admin/inventory/[id]/edit/actions.ts
"use server";

import { readInventoryData } from "../../initial-read";

import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";
import { ProductService } from "@/services/product-service";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { loadSpecialtyProductDraft } from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/load-specialty-product-draft";

export async function getEditFormInitialData(productId: string) {
  return readInventoryData(async (supabase, tenantId, signal) => {
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

    signal.throwIfAborted();
    if (product && !brandsData.some((brand) => brand.id === product.brand.id)) {
      brandsData.push({
        ...(await taxonomyRepo.getBrandById(product.brand.id))!,
      });
    }
    signal.throwIfAborted();
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
        signal.throwIfAborted();
        const selectedSize = await taxonomyRepo.getSizeById(variant.size.id);
        if (selectedSize) {
          sizesData.push(selectedSize);
        }
      }
    }

    signal.throwIfAborted();
    return {
      specialtyInitial: product
        ? await loadSpecialtyProductDraft(product, createSupabaseAdminClient())
        : undefined,
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
  });
}
