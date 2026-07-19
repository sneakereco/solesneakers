// src/services/storefront-service.ts
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { ProductRepository, type ProductFilters } from "@/repositories/product-repo";

export class StorefrontService {
  private productRepo: ProductRepository;

  constructor(private readonly supabase: TypedSupabaseClient) {
    this.productRepo = new ProductRepository(supabase);
  }

  async listProducts(filters: ProductFilters) {
    return this.productRepo.list(await this.resolveCanonicalSearch(filters));
  }

  async getProductById(id: string, opts?: { includeOutOfStock?: boolean }) {
    return this.productRepo.getById(id, {
      includeOutOfStock: opts?.includeOutOfStock,
    });
  }

  async listFilters(opts?: { includeOutOfStock?: boolean; filters?: ProductFilters }) {
    const resolvedFilters = opts?.filters
      ? await this.resolveCanonicalSearch(opts.filters)
      : undefined;
    const sizeFilters = resolvedFilters ? { ...resolvedFilters } : undefined;
    if (sizeFilters) {
      sizeFilters.includeOutOfStock = opts?.includeOutOfStock;
      sizeFilters.sizeIds = [];
    }

    const conditionFilters = resolvedFilters ? { ...resolvedFilters } : undefined;
    if (conditionFilters) {
      conditionFilters.includeOutOfStock = opts?.includeOutOfStock;
      conditionFilters.condition = [];
    }

    const [data, sizeData, availableConditions] = await Promise.all([
      this.productRepo.listFilterData({
        includeOutOfStock: opts?.includeOutOfStock,
      }),
      this.productRepo.listAvailableSizes(sizeFilters),
      this.productRepo.listAvailableConditions(conditionFilters),
    ]);

    const brandMap = new Map<string, { id: string; label: string }>();
    const modelsByBrand: Record<string, Array<{ id: string; label: string }>> = {};
    const brandsByCategory: Record<string, Array<{ id: string; label: string }>> = {};
    const modelMap = new Map<string, { id: string; label: string; brandId: string }>();
    const categorySet = new Set<string>();

    for (const product of data) {
      if (product.brand) {
        brandMap.set(product.brandId, { id: product.brandId, label: product.brand });
      }

      if (product.category === "sneakers" && product.model && product.brand) {
        modelMap.set(product.modelId!, {
          id: product.modelId!,
          label: product.model,
          brandId: product.brandId,
        });
        if (!modelsByBrand[product.brandId]) {
          modelsByBrand[product.brandId] = [];
        }
        if (
          !modelsByBrand[product.brandId].some((model) => model.id === product.modelId)
        ) {
          modelsByBrand[product.brandId].push({
            id: product.modelId!,
            label: product.model,
          });
        }
      }

      if (product.category) {
        categorySet.add(product.category);
        if (product.brand) {
          if (!brandsByCategory[product.category]) {
            brandsByCategory[product.category] = [];
          }
          if (
            !brandsByCategory[product.category].some(
              (brand) => brand.id === product.brandId,
            )
          ) {
            brandsByCategory[product.category].push({
              id: product.brandId,
              label: product.brand,
            });
          }
        }
      }
    }

    const sortWithOtherLast = <T extends { label: string }>(values: T[]) => {
      const sorted = values.slice().sort((a, b) => a.label.localeCompare(b.label));
      const otherIndex = sorted.findIndex(
        (value) => value.label.toLowerCase() === "other",
      );
      if (otherIndex === -1) {
        return sorted;
      }
      const [other] = sorted.splice(otherIndex, 1);
      sorted.push(other);
      return sorted;
    };

    const brands = sortWithOtherLast(Array.from(brandMap.values()));

    for (const brand of Object.keys(modelsByBrand)) {
      modelsByBrand[brand] = modelsByBrand[brand].sort((a, b) =>
        a.label.localeCompare(b.label),
      );
    }

    for (const category of Object.keys(brandsByCategory)) {
      brandsByCategory[category] = sortWithOtherLast(brandsByCategory[category]);
    }

    const models = Array.from(modelMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    const categoryOrder = ["sneakers", "clothing", "accessories", "electronics"];
    const categories = Array.from(categorySet).sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);
      if (aIndex === -1 && bIndex === -1) {
        return a.localeCompare(b);
      }
      if (aIndex === -1) {
        return 1;
      }
      if (bIndex === -1) {
        return -1;
      }
      return aIndex - bIndex;
    });

    return {
      brands,
      models,
      modelsByBrand,
      brandsByCategory,
      categories,
      availableShoeSizes: sizeData.shoe,
      availableClothingSizes: sizeData.clothing,
      shoeSizeCounts: sizeData.shoeCounts,
      clothingSizeCounts: sizeData.clothingCounts,
      availableConditions,
    };
  }

  private async resolveCanonicalSearch(filters: ProductFilters) {
    if (filters.searchMode === "inventory" || !filters.q?.trim()) {
      return filters;
    }

    const matchingProductIds = await this.productRepo.listCanonicalSearchProductIds(
      filters.q,
      filters.tenantId,
    );
    return { ...filters, matchingProductIds };
  }
}
