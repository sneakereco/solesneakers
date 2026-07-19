// src/services/product-title-parser-service.ts
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";
import {
  normalizeLabel,
  parseTitleWithTaxonomy,
  type TaxonomyBrandAlias,
  type TaxonomyModelAlias,
  type TitleParseInput,
  type TitleParseResult,
} from "@/services/product-title-parser";

export class ProductTitleParserService {
  private taxonomyRepo: TagTaxonomyRepository;
  private taxonomyCache = new Map<
    string,
    Promise<{
      brandAliases: TaxonomyBrandAlias[];
      modelAliasesByBrand: Record<string, TaxonomyModelAlias[]>;
      modelAliasesAll: TaxonomyModelAlias[];
      preferredBrandIds: Set<string>;
    }>
  >();

  constructor(private readonly supabase: TypedSupabaseClient) {
    this.taxonomyRepo = new TagTaxonomyRepository(supabase);
  }

  async parseTitle(
    input: TitleParseInput & { tenantId?: string | null },
  ): Promise<TitleParseResult> {
    const tenantId = input.tenantId ?? null;
    const cacheKey = tenantId ?? "__global__";

    let taxonomyPromise = this.taxonomyCache.get(cacheKey);
    if (!taxonomyPromise) {
      taxonomyPromise = this.loadTaxonomy(tenantId);
      this.taxonomyCache.set(cacheKey, taxonomyPromise);
    }

    const { brandAliases, modelAliasesByBrand, modelAliasesAll, preferredBrandIds } =
      await taxonomyPromise;

    return parseTitleWithTaxonomy(input, {
      brandAliases,
      modelAliasesByBrand,
      modelAliasesAll,
      preferredBrandIds,
    });
  }

  private async loadTaxonomy(tenantId: string | null) {
    const [brands, brandAliases, models, modelAliases] = await Promise.all([
      this.taxonomyRepo.listBrands(tenantId),
      this.taxonomyRepo.listBrandAliases(tenantId),
      this.taxonomyRepo.listModels(tenantId),
      this.taxonomyRepo.listModelAliasesAll(tenantId),
    ]);

    const brandAliasEntries: TaxonomyBrandAlias[] = [];
    const brandAliasKeys = new Set<string>();

    for (const brand of brands) {
      const normalized = normalizeLabel(brand.canonical_label);
      const key = `${brand.id}:${normalized}`;
      if (!brandAliasKeys.has(key)) {
        brandAliasKeys.add(key);
        brandAliasEntries.push({
          brandId: brand.id,
          brandLabel: brand.canonical_label,
          aliasLabel: brand.canonical_label,
          aliasNormalized: normalized,
          priority: 0,
        });
      }
    }

    for (const alias of brandAliases) {
      if (!alias.brand) {
        continue;
      }
      const key = `${alias.brand.id}:${alias.alias_normalized}`;
      if (brandAliasKeys.has(key)) {
        continue;
      }
      brandAliasKeys.add(key);
      brandAliasEntries.push({
        brandId: alias.brand.id,
        brandLabel: alias.brand.canonical_label,
        aliasLabel: alias.alias_label,
        aliasNormalized: alias.alias_normalized,
        priority: alias.priority ?? 0,
      });
    }

    const PREFERRED_BRANDS = new Set(["nike"]);
    const DEPRIORITIZED_BRANDS = new Set(["off white", "off-white"]);

    const nikeBrand = brands.find((b) => normalizeLabel(b.canonical_label) === "nike");
    const preferredBrandIds = new Set<string>();
    if (nikeBrand) {
      preferredBrandIds.add(nikeBrand.id);
    }

    for (const entry of brandAliasEntries) {
      const label = normalizeLabel(entry.brandLabel);

      if (PREFERRED_BRANDS.has(label)) {
        entry.priority = Math.max(entry.priority ?? 0, 50);
      }

      if (DEPRIORITIZED_BRANDS.has(label)) {
        entry.priority = Math.min(entry.priority ?? 0, -10);
      }
    }

    const modelAliasEntries: TaxonomyModelAlias[] = [];
    const modelAliasKeys = new Set<string>();

    for (const model of models) {
      const normalized = normalizeLabel(model.canonical_label);
      const key = `${model.id}:${normalized}`;
      if (!modelAliasKeys.has(key)) {
        modelAliasKeys.add(key);
        modelAliasEntries.push({
          modelId: model.id,
          modelLabel: model.canonical_label,
          brandId: model.brand_id,
          aliasLabel: model.canonical_label,
          aliasNormalized: normalized,
          priority: 0,
        });
      }
    }

    for (const alias of modelAliases) {
      if (!alias.model) {
        continue;
      }
      const key = `${alias.model.id}:${alias.alias_normalized}`;
      if (modelAliasKeys.has(key)) {
        continue;
      }
      modelAliasKeys.add(key);
      modelAliasEntries.push({
        modelId: alias.model.id,
        modelLabel: alias.model.canonical_label,
        brandId: alias.model.brand_id,
        aliasLabel: alias.alias_label,
        aliasNormalized: alias.alias_normalized,
        priority: alias.priority ?? 0,
      });
    }

    const modelAliasesByBrand: Record<string, TaxonomyModelAlias[]> = {};
    for (const alias of modelAliasEntries) {
      if (!modelAliasesByBrand[alias.brandId]) {
        modelAliasesByBrand[alias.brandId] = [];
      }
      modelAliasesByBrand[alias.brandId].push(alias);
    }

    return {
      brandAliases: brandAliasEntries,
      modelAliasesByBrand,
      modelAliasesAll: modelAliasEntries,
      preferredBrandIds,
    };
  }
}
