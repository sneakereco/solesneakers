import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";
import { normalizeLabel } from "@/services/product-title-parser";

export class TagTaxonomyService {
  private readonly repo: TagTaxonomyRepository;

  constructor(supabase: TypedSupabaseClient) {
    this.repo = new TagTaxonomyRepository(supabase);
  }

  listBrands(tenantId?: string | null, includeInactive = false) {
    return this.repo.listBrands(tenantId, includeInactive);
  }

  createBrand(input: {
    tenantId: string | null;
    canonicalLabel: string;
    isActive?: boolean;
  }) {
    return this.repo.createBrand({
      tenant_id: input.tenantId,
      canonical_label: input.canonicalLabel.trim(),
      is_active: input.isActive ?? true,
    });
  }

  updateBrand(id: string, input: { canonicalLabel?: string; isActive?: boolean }) {
    return this.repo.updateBrand(id, {
      canonical_label: input.canonicalLabel?.trim(),
      is_active: input.isActive,
    });
  }

  listModels(tenantId?: string | null, brandId?: string | null, includeInactive = false) {
    return this.repo.listModels(tenantId, brandId, includeInactive);
  }

  createModel(input: {
    tenantId: string | null;
    brandId: string;
    canonicalLabel: string;
    isActive?: boolean;
  }) {
    return this.repo.createModel({
      tenant_id: input.tenantId,
      brand_id: input.brandId,
      canonical_label: input.canonicalLabel.trim(),
      is_active: input.isActive ?? true,
    });
  }

  updateModel(
    id: string,
    input: { brandId?: string; canonicalLabel?: string; isActive?: boolean },
  ) {
    return this.repo.updateModel(id, {
      brand_id: input.brandId,
      canonical_label: input.canonicalLabel?.trim(),
      is_active: input.isActive,
    });
  }

  listAliases(
    tenantId?: string | null,
    entityType?: "brand" | "model",
    includeInactive = false,
  ) {
    return this.repo.listAliases(tenantId, entityType, includeInactive);
  }

  createAlias(input: {
    tenantId: string | null;
    entityType: "brand" | "model";
    brandId?: string | null;
    modelId?: string | null;
    aliasLabel: string;
    priority?: number;
    isActive?: boolean;
  }) {
    return this.repo.createAlias({
      tenant_id: input.tenantId,
      entity_type: input.entityType,
      brand_id: input.brandId ?? null,
      model_id: input.modelId ?? null,
      alias_label: input.aliasLabel.trim(),
      alias_normalized: normalizeLabel(input.aliasLabel),
      priority: input.priority ?? 0,
      is_active: input.isActive ?? true,
    });
  }

  updateAlias(
    id: string,
    input: { aliasLabel?: string; priority?: number; isActive?: boolean },
  ) {
    return this.repo.updateAlias(id, {
      alias_label: input.aliasLabel?.trim(),
      alias_normalized: input.aliasLabel ? normalizeLabel(input.aliasLabel) : undefined,
      priority: input.priority,
      is_active: input.isActive,
    });
  }

  listCandidates(tenantId: string, status?: string) {
    return this.repo.listCandidates(tenantId, status);
  }

  rejectCandidate(id: string) {
    return this.repo.updateCandidate(id, { status: "rejected" });
  }

  async acceptCandidate(input: { id: string; canonicalLabel?: string }) {
    const candidate = await this.repo.getCandidateById(input.id);
    if (!candidate) {
      throw new Error("Candidate not found");
    }
    return this.repo.acceptCandidate(
      candidate.id,
      input.canonicalLabel?.trim() || candidate.raw_text,
    );
  }

  listSizes(tenantId?: string | null, sizeType?: string | null, includeInactive = false) {
    return this.repo.listSizes(tenantId, sizeType, includeInactive);
  }

  createSize(input: {
    tenantId: string | null;
    sizeType: string;
    canonicalLabel: string;
    sortOrder?: number;
    isActive?: boolean;
  }) {
    return this.repo.createSize({
      tenant_id: input.tenantId,
      size_type: input.sizeType,
      canonical_label: input.canonicalLabel.trim(),
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
    });
  }

  updateSize(
    id: string,
    input: { canonicalLabel?: string; sortOrder?: number; isActive?: boolean },
  ) {
    return this.repo.updateSize(id, {
      canonical_label: input.canonicalLabel?.trim(),
      sort_order: input.sortOrder,
      is_active: input.isActive,
    });
  }
}
