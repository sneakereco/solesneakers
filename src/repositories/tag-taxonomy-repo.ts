import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { TablesInsert, TablesUpdate } from "@/types/db/database.types";

type TenantQuery = {
  is: (column: string, value: null) => TenantQuery;
  or: (filter: string) => TenantQuery;
};

export class TagTaxonomyRepository {
  constructor(private readonly supabase: TypedSupabaseClient) {}

  private withTenantScope<T extends TenantQuery>(query: T, tenantId?: string | null): T {
    if (!tenantId) {
      return query.is("tenant_id", null) as T;
    }
    return query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`) as T;
  }

  async listBrands(tenantId?: string | null, includeInactive = false) {
    let query = this.withTenantScope(
      this.supabase.from("tag_brands").select("*").order("canonical_label"),
      tenantId,
    );
    if (!includeInactive) {
      query = query.eq("is_active", true);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return data ?? [];
  }

  async getBrandById(id: string) {
    const { data, error } = await this.supabase
      .from("tag_brands")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data;
  }

  async createBrand(input: TablesInsert<"tag_brands">) {
    const { data, error } = await this.supabase
      .from("tag_brands")
      .insert(input)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async updateBrand(id: string, input: TablesUpdate<"tag_brands">) {
    const { data, error } = await this.supabase
      .from("tag_brands")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async listModels(
    tenantId?: string | null,
    brandId?: string | null,
    includeInactive = false,
  ) {
    let query = this.withTenantScope(
      this.supabase
        .from("tag_models")
        .select("*, brand:tag_brands(id, canonical_label, is_active)")
        .order("canonical_label"),
      tenantId,
    );
    if (brandId) {
      query = query.eq("brand_id", brandId);
    }
    if (!includeInactive) {
      query = query.eq("is_active", true);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return data ?? [];
  }

  async getModelById(id: string) {
    const { data, error } = await this.supabase
      .from("tag_models")
      .select("*, brand:tag_brands(id, canonical_label, is_active)")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data;
  }

  async createModel(input: TablesInsert<"tag_models">) {
    const { data, error } = await this.supabase
      .from("tag_models")
      .insert(input)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async updateModel(id: string, input: TablesUpdate<"tag_models">) {
    const { data, error } = await this.supabase
      .from("tag_models")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async listAliases(
    tenantId?: string | null,
    entityType?: "brand" | "model",
    includeInactive = false,
  ) {
    let query = this.withTenantScope(
      this.supabase
        .from("tag_aliases")
        .select(
          "*, brand:tag_brands(id, canonical_label), model:tag_models(id, canonical_label, brand_id)",
        )
        .order("priority", { ascending: false }),
      tenantId,
    );
    if (entityType) {
      query = query.eq("entity_type", entityType);
    }
    if (!includeInactive) {
      query = query.eq("is_active", true);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return data ?? [];
  }

  async listBrandAliases(tenantId?: string | null) {
    return this.listAliases(tenantId, "brand");
  }

  async listModelAliasesAll(tenantId?: string | null) {
    return this.listAliases(tenantId, "model");
  }

  async createAlias(input: TablesInsert<"tag_aliases">) {
    const { data, error } = await this.supabase
      .from("tag_aliases")
      .insert(input)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async updateAlias(id: string, input: TablesUpdate<"tag_aliases">) {
    const { data, error } = await this.supabase
      .from("tag_aliases")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async listCandidates(tenantId: string, status?: string) {
    let query = this.supabase
      .from("tag_candidates")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (status) {
      query = query.eq("status", status);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return data ?? [];
  }

  async createCandidate(input: TablesInsert<"tag_candidates">) {
    const { data, error } = await this.supabase
      .from("tag_candidates")
      .insert(input)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async updateCandidate(id: string, input: TablesUpdate<"tag_candidates">) {
    const { data, error } = await this.supabase
      .from("tag_candidates")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async getCandidateById(id: string) {
    const { data, error } = await this.supabase
      .from("tag_candidates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data;
  }

  async acceptCandidate(id: string, canonicalLabel: string) {
    const { data, error } = await this.supabase.rpc("accept_tag_candidate", {
      candidate_id: id,
      accepted_label: canonicalLabel,
    });
    if (error) {
      throw error;
    }
    return data;
  }

  async listSizes(
    tenantId?: string | null,
    sizeType?: string | null,
    includeInactive = false,
  ) {
    let query = this.withTenantScope(
      this.supabase
        .from("tag_sizes")
        .select("*")
        .order("size_type")
        .order("sort_order")
        .order("canonical_label"),
      tenantId,
    );
    if (sizeType) {
      query = query.eq("size_type", sizeType);
    }
    if (!includeInactive) {
      query = query.eq("is_active", true);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return data ?? [];
  }

  async getSizeById(id: string) {
    const { data, error } = await this.supabase
      .from("tag_sizes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data;
  }

  async createSize(input: TablesInsert<"tag_sizes">) {
    const { data, error } = await this.supabase
      .from("tag_sizes")
      .insert(input)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async updateSize(id: string, input: TablesUpdate<"tag_sizes">) {
    const { data, error } = await this.supabase
      .from("tag_sizes")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      throw error;
    }
    return data;
  }
}
