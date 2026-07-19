//  src/repositories/product-repo.ts
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { Tables, TablesInsert, TablesUpdate } from "@/types/db/database.types";

export interface ProductFilters {
  q?: string;
  category?: string[];
  brandIds?: string[];
  modelIds?: string[];
  sizeIds?: string[];
  condition?: string[];
  priceMinCents?: number;
  priceMaxCents?: number;
  sort?:
    | "relevance"
    | "newest"
    | "oldest"
    | "price_asc"
    | "price_desc"
    | "name_asc"
    | "name_desc";
  page?: number;
  limit?: number;
  stockStatus?: "in_stock" | "out_of_stock" | "archived" | "all";
  archivedStatus?: "active" | "archived" | "all";
  includeOutOfStock?: boolean;

  tenantId?: string;
  searchMode?: "storefront" | "inventory";

  // Resolved by StorefrontService so taxonomy labels can participate in search.
  matchingProductIds?: string[];
}

type ProductRow = Tables<"products">;
type VariantRow = Tables<"product_variants">;
type ImageRow = Tables<"product_images">;
type BrandRow = Tables<"tag_brands">;
type ModelRow = Tables<"tag_models">;
type SizeRow = Tables<"tag_sizes">;
type SearchableProductRow = Pick<ProductRow, "id" | "name">;

export type ProductWithDetails = ProductRow & {
  brand: { id: string; label: string };
  model: { id: string; label: string } | null;
  variants: Array<VariantRow & { size: { id: string; label: string } }>;
  images: ImageRow[];
};

export type CartVariantDetails = {
  variantId: string;
  productId: string;
  sizeLabel: string;
  priceCents: number;
  sku: string;
  stock: number;
  brand: string;
  name: string;
  titleDisplay: string;
  isActive: boolean;
  isOutOfStock: boolean;
  imageUrl: string | null;
};

export type InventoryExportRow = {
  sku: string;
  name: string;
  size: string;
  type: string;
  condition: string;
  salePriceCents: number;
  unitCostCents: number;
  stock: number;
};

type VariantExportRow = {
  sku: string | null;
  size?: { canonical_label: string | null };
  sale_price_cents: number | null;
  unit_cost_cents: number | null;
  stock: number | null;
  product?: {
    name: string | null;
    condition: string | null;
    is_active: boolean | null;
    is_out_of_stock: boolean | null;
    tenant_id: string | null;
    category: string | null;
  };
};

type ProductInsert = TablesInsert<"products">;
type ProductUpdate = TablesUpdate<"products">;

type VariantInsert = TablesInsert<"product_variants">;
type VariantUpdate = TablesUpdate<"product_variants">;
type ImageInsert = TablesInsert<"product_images">;

const BULK_MUTATION_BATCH_SIZE = 100;
const QUERY_PAGE_SIZE = 1000;

// Helper types for query results
type FilterDataRow = {
  brand_id: string;
  model_id: string | null;
  brand?: { canonical_label: string };
  model?: { canonical_label: string } | null;
  category: string | null;
};

export type ProductFilterData = {
  brandId: string;
  brand: string;
  modelId: string | null;
  model: string | null;
  category: string | null;
};

type SizeAvailabilityRow = {
  product_id: string;
  size_id: string;
  size?: { canonical_label?: string | null };
  product?: {
    size_type?: string | null;
  };
};

type ProductWithRelations = ProductRow & {
  brand?: BrandRow;
  model?: ModelRow | null;
  variants?: Array<VariantRow & { size?: SizeRow }>;
  images?: ImageRow[];
};

type VariantWithProduct = {
  product_id: string;
  sale_price_cents: number;
  product?: {
    id: string;
  };
};

type CheckoutProductRow = {
  id: string;
  name: string;
  brand_id: string;
  model_id: string | null;
  brand?: { canonical_label: string };
  model?: { canonical_label: string } | null;
  category: string;
  condition: string;
  tenant_id: string | null;
  shipping_price_cents: number | null;
  variants?: Array<{
    id: string;
    sku: string;
    size_id: string;
    size?: { canonical_label: string };
    sale_price_cents: number;
    unit_cost_cents: number;
    stock: number;
  }>;
};

type CartVariantRow = {
  id: string;
  product_id: string;
  sku: string;
  size_id: string;
  size?: { canonical_label: string };
  sale_price_cents: number;
  stock: number;
  product?: {
    id: string;
    brand_id: string;
    brand?: { canonical_label: string };
    name: string;
    is_active: boolean;
    is_out_of_stock: boolean;
    go_live_at: string | null;
  };
};

type ProductImageRow = {
  product_id: string;
  url: string;
  is_primary: boolean;
  sort_order: number;
};

export class ProductRepository {
  private static readonly RECONCILIATION_PAGE_SIZE = 1000;

  constructor(private readonly supabase: TypedSupabaseClient) {}

  private readonly storefrontSearchFields = ["name"];

  private readonly inventorySearchFields = ["name"];

  async listCanonicalSearchProductIds(input: string, tenantId?: string) {
    const terms = this.buildSearchTerms(input);
    if (terms.length === 0) {
      return [];
    }

    const taxonomyClauses = terms.map((term) => {
      const safe = term.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
      return `canonical_label.ilike.%${safe}%`;
    });

    const [brandsResult, modelsResult] = await Promise.all([
      this.supabase
        .from("tag_brands")
        .select("id")
        .eq("is_active", true)
        .or(taxonomyClauses.join(","))
        .limit(100),
      this.supabase
        .from("tag_models")
        .select("id")
        .eq("is_active", true)
        .or(taxonomyClauses.join(","))
        .limit(100),
    ]);

    if (brandsResult.error) {
      throw brandsResult.error;
    }
    if (modelsResult.error) {
      throw modelsResult.error;
    }

    const clauses = terms.map((term) => {
      const safe = term.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
      return `name.ilike.%${safe}%`;
    });
    const brandIds = (brandsResult.data ?? []).map((brand) => brand.id);
    const modelIds = (modelsResult.data ?? []).map((model) => model.id);

    if (brandIds.length > 0) {
      clauses.push(`brand_id.in.(${this.buildInClause(brandIds)})`);
    }
    if (modelIds.length > 0) {
      clauses.push(`model_id.in.(${this.buildInClause(modelIds)})`);
    }

    let query = this.supabase.from("products").select("id").or(clauses.join(","));
    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    // Keep the candidate ID filter below practical PostgREST URL limits.
    const { data, error } = await query.limit(500);
    if (error) {
      throw error;
    }

    return (data ?? []).map((product) => product.id);
  }

  private applyArchivedFilter<
    T extends {
      is: (column: string, value: null) => T;
      not: (column: string, operator: string, value: null) => T;
    },
  >(query: T, archivedStatus: ProductFilters["archivedStatus"] = "active"): T {
    if (archivedStatus === "archived") {
      return query.not("archived_at", "is", null);
    }
    if (archivedStatus === "all") {
      return query;
    }
    return query.is("archived_at", null);
  }

  async listForReconciliation(
    tenantId: string,
    archivedStatus: ProductFilters["archivedStatus"] = "active",
  ): Promise<ProductWithDetails[]> {
    const rows: ProductWithRelations[] = [];
    let offset = 0;

    while (true) {
      let query = this.supabase
        .from("products")
        .select(
          "*, brand:tag_brands(*), model:tag_models(*), variants:product_variants(*, size:tag_sizes(*)), images:product_images(*)",
        )
        .eq("tenant_id", tenantId);

      query = this.applyArchivedFilter(query, archivedStatus).order("created_at", {
        ascending: false,
      });

      const { data, error } = await query.range(
        offset,
        offset + ProductRepository.RECONCILIATION_PAGE_SIZE - 1,
      );

      if (error) {
        throw error;
      }

      const page = (data ?? []) as ProductWithRelations[];
      rows.push(...page);

      if (page.length < ProductRepository.RECONCILIATION_PAGE_SIZE) {
        break;
      }

      offset += ProductRepository.RECONCILIATION_PAGE_SIZE;
    }

    return rows.map((row) => this.transformProduct(row));
  }

  async exportInventoryRows(filters: ProductFilters): Promise<InventoryExportRow[]> {
    const includeOutOfStock = Boolean(filters.includeOutOfStock);

    let query = this.supabase
      .from("product_variants")
      .select(
        "sku, size:tag_sizes(canonical_label), sale_price_cents, unit_cost_cents, stock, product:products!inner(name, condition, is_active, is_out_of_stock, tenant_id, category)",
      )
      .eq("product.is_active", true);

    if (filters.tenantId) {
      query = query.eq("product.tenant_id", filters.tenantId);
    }
    if (filters.archivedStatus === "archived") {
      query = query.not("product.archived_at", "is", null);
    } else if (filters.archivedStatus !== "all") {
      query = query.is("product.archived_at", null);
    }

    if (filters.stockStatus === "out_of_stock") {
      query = query.eq("product.is_out_of_stock", true);
    } else if (filters.stockStatus === "in_stock") {
      query = query.eq("product.is_out_of_stock", false).gt("stock", 0);
    } else if (!includeOutOfStock) {
      query = query.eq("product.is_out_of_stock", false).gt("stock", 0);
    }

    query = this.applyTextSearch(query, filters.q, this.inventorySearchFields, {
      foreignTable: "product",
    });
    if (filters.q?.trim()) {
      query = query.or(`sku.ilike.%${filters.q.trim().replace(/[(),]/g, " ")}%`);
    }

    if (filters.category?.length) {
      query = query.in("product.category", filters.category);
    }
    if (filters.condition?.length) {
      query = query.in("product.condition", filters.condition);
    }

    // Order for stable printing
    query = query
      .order("sku", { ascending: true })
      .order("sort_order", { ascending: true });

    const { data, error } = await query.limit(20000);
    if (error) {
      throw error;
    }

    const rows = (data ?? []) as VariantExportRow[];

    return rows
      .map((row) => {
        const product = row.product;
        const sku = row.sku?.trim() ?? "";
        const name = product?.name?.trim() ?? "";
        const size = row.size?.canonical_label?.trim() ?? "";
        const type = product?.category?.trim() ?? "";
        const condition = product?.condition?.trim() ?? "";

        if (!sku || !name || !size || !condition) {
          return null;
        }

        return {
          sku,
          name,
          size,
          type,
          condition,
          salePriceCents: Number(row.sale_price_cents ?? 0),
          unitCostCents: Number(row.unit_cost_cents ?? 0),
          stock: Number(row.stock ?? 0),
        } satisfies InventoryExportRow;
      })
      .filter((row): row is InventoryExportRow => row !== null);
  }

  async list(filters: ProductFilters = {}) {
    const { page = 1, limit = 20, sort = "newest", searchMode = "storefront" } = filters;
    const archivedStatus = filters.archivedStatus ?? "active";
    const offset = (page - 1) * limit;
    const isPriceSort = sort === "price_asc" || sort === "price_desc";
    const hasPriceFilter =
      typeof filters.priceMinCents === "number" ||
      typeof filters.priceMaxCents === "number";
    const includeUnpublished = searchMode === "inventory";
    const nowIso = new Date().toISOString();
    const hasResolvedSearch = Array.isArray(filters.matchingProductIds);
    const searchFields =
      searchMode === "inventory"
        ? this.inventorySearchFields
        : this.storefrontSearchFields;

    const sizeProductIds = isPriceSort
      ? null
      : await this.listProductIdsForSizes(filters);
    if (Array.isArray(sizeProductIds) && sizeProductIds.length === 0) {
      return { products: [], total: 0, skuTotal: 0, inventoryUnitTotal: 0, page, limit };
    }
    if (hasResolvedSearch && filters.matchingProductIds!.length === 0) {
      return { products: [], total: 0, skuTotal: 0, inventoryUnitTotal: 0, page, limit };
    }

    // IMPORTANT:
    // - Storefront must not include out-of-stock items by default.
    // - Admin can include them by passing includeOutOfStock=true.
    const includeOutOfStock = Boolean(filters.includeOutOfStock);

    let total = 0;
    let skuTotal = 0;
    let inventoryUnitTotal = 0;
    let ids: string[] = [];

    if (isPriceSort) {
      const result = await this.listProductIdsByPrice(
        filters,
        sort,
        includeOutOfStock,
        includeUnpublished,
        nowIso,
      );
      ids = result.ids;
      total = result.total;
      skuTotal = result.total;
      inventoryUnitTotal = 0;
    } else {
      // Build the base query with all filters
      let baseQuery = this.supabase
        .from("products")
        .select(hasPriceFilter ? "id, name, product_variants!inner(id)" : "id, name", {
          count: "exact",
        });

      baseQuery = baseQuery.eq("is_active", true);
      baseQuery = this.applyArchivedFilter(baseQuery, archivedStatus);

      if (!includeUnpublished) {
        baseQuery = baseQuery.lte("go_live_at", nowIso);
      }

      if (filters.tenantId) {
        baseQuery = baseQuery.eq("tenant_id", filters.tenantId);
      }

      if (filters.stockStatus === "out_of_stock") {
        baseQuery = baseQuery.eq("is_out_of_stock", true);
      } else if (filters.stockStatus === "in_stock") {
        if (searchMode !== "inventory") {
          baseQuery = baseQuery.eq("is_out_of_stock", false);
        }
      } else if (!includeOutOfStock) {
        // default (storefront-safe)
        baseQuery = baseQuery.eq("is_out_of_stock", false);
      }

      // Text search
      if (hasResolvedSearch) {
        baseQuery = baseQuery.in("id", filters.matchingProductIds!);
      } else {
        baseQuery = this.applyTextSearch(baseQuery, filters.q, searchFields);
      }

      // Category / brand / condition filters
      if (filters.category?.length) {
        baseQuery = baseQuery.in("category", filters.category);
      }
      if (filters.brandIds?.length) {
        baseQuery = baseQuery.in("brand_id", filters.brandIds);
      }
      if (filters.modelIds?.length) {
        baseQuery = baseQuery.in("model_id", filters.modelIds);
      }
      if (filters.condition?.length) {
        baseQuery = baseQuery.in("condition", filters.condition);
      }

      if (Array.isArray(sizeProductIds)) {
        baseQuery = baseQuery.in("id", sizeProductIds);
      }
      if (hasPriceFilter) {
        baseQuery = baseQuery.gt("product_variants.stock", 0);
        if (typeof filters.priceMinCents === "number") {
          baseQuery = baseQuery.gte(
            "product_variants.sale_price_cents",
            filters.priceMinCents,
          );
        }
        if (typeof filters.priceMaxCents === "number") {
          baseQuery = baseQuery.lte(
            "product_variants.sale_price_cents",
            filters.priceMaxCents,
          );
        }
      }

      // Determine if we have a search query
      const hasSearchQuery = Boolean(filters.q?.trim());

      // For search queries, we need to fetch more results to properly rank them
      // So we'll get the total count first, then fetch accordingly
      let query = baseQuery;

      if (!hasSearchQuery) {
        // No search - use normal sorting and pagination
        switch (sort) {
          case "relevance":
          case "newest":
            query = query.order("created_at", { ascending: false });
            break;
          case "oldest":
            query = query.order("created_at", { ascending: true });
            break;
          case "name_asc":
            query = query
              .order("name", { ascending: true })
              .order("created_at", { ascending: false });
            break;
          case "name_desc":
            query = query
              .order("name", { ascending: false })
              .order("created_at", { ascending: false });
            break;
        }
        query = query.range(offset, offset + limit - 1);
      } else {
        // For searches, fetch more results to score and rank them
        // Fetch up to 500 results to ensure good ranking
        const fetchLimit = 500;
        switch (sort) {
          case "oldest":
            query = query.order("created_at", { ascending: true });
            break;
          case "name_asc":
            query = query.order("name", { ascending: true });
            break;
          case "name_desc":
            query = query.order("name", { ascending: false });
            break;
          default:
            query = query.order("created_at", { ascending: false });
            break;
        }
        query = query.range(0, fetchLimit - 1);
      }

      const { data, error, count } = await query;
      if (error) {
        throw error;
      }

      // Supabase's select-string parser cannot infer the conditional inner relation,
      // but the product columns retain this stable runtime shape.
      const candidateRows = (data ?? []) as unknown as SearchableProductRow[];
      ids =
        hasSearchQuery && sort === "relevance"
          ? candidateRows
              .map((product) => ({
                id: product.id,
                score: this.calculateSearchRelevance(product, filters.q, searchFields),
              }))
              .sort((left, right) => right.score - left.score)
              .slice(offset, offset + limit)
              .map((candidate) => candidate.id)
          : hasSearchQuery
            ? candidateRows.slice(offset, offset + limit).map((row) => row.id)
            : candidateRows.map((row) => row.id);
      total = count ?? 0;
      skuTotal =
        searchMode === "inventory"
          ? await this.countDistinctInventorySkus({
              filters,
              archivedStatus,
              includeUnpublished,
              nowIso,
            })
          : total;
      inventoryUnitTotal =
        searchMode === "inventory"
          ? await this.countTotalInventoryUnits({
              filters,
              archivedStatus,
              includeUnpublished,
              nowIso,
            })
          : 0;
    }
    if (ids.length === 0) {
      return { products: [], total, skuTotal, inventoryUnitTotal, page, limit };
    }

    // PostgREST serializes .in() values into the request URL. Broad searches can
    // produce hundreds of UUIDs, so fetch details in bounded batches.
    const detailIdBatches: string[][] = [];
    const detailIdBatchSize = 100;
    for (let index = 0; index < ids.length; index += detailIdBatchSize) {
      detailIdBatches.push(ids.slice(index, index + detailIdBatchSize));
    }

    const detailBatches = await Promise.all(
      detailIdBatches.map(async (idBatch) => {
        let detailQuery = this.supabase
          .from("products")
          .select(
            "*, brand:tag_brands(*), model:tag_models(*), variants:product_variants(*, size:tag_sizes(*)), images:product_images(*)",
          )
          .in("id", idBatch)
          .eq("is_active", true);
        detailQuery = this.applyArchivedFilter(detailQuery, archivedStatus);

        if (!includeUnpublished) {
          detailQuery = detailQuery.lte("go_live_at", nowIso);
        }

        if (filters.stockStatus === "out_of_stock") {
          detailQuery = detailQuery.eq("is_out_of_stock", true);
        } else if (filters.stockStatus === "in_stock") {
          if (searchMode !== "inventory") {
            detailQuery = detailQuery.eq("is_out_of_stock", false);
          }
        } else if (!includeOutOfStock) {
          detailQuery = detailQuery.eq("is_out_of_stock", false);
        }

        if (filters.tenantId) {
          detailQuery = detailQuery.eq("tenant_id", filters.tenantId);
        }

        const { data, error } = await detailQuery;
        if (error) {
          throw error;
        }
        return data ?? [];
      }),
    );
    const details = detailBatches.flat();

    const byId = new Map(
      details.map((raw) => [raw.id, this.transformProduct(raw as ProductWithRelations)]),
    );

    const products = ids
      .map((id) => byId.get(id))
      .filter(Boolean) as ProductWithDetails[];

    return {
      products,
      total,
      skuTotal,
      inventoryUnitTotal,
      page,
      limit,
    };
  }

  private async countDistinctInventorySkus(input: {
    filters: ProductFilters;
    archivedStatus: ProductFilters["archivedStatus"];
    includeUnpublished: boolean;
    nowIso: string;
  }) {
    const { filters, archivedStatus, includeUnpublished, nowIso } = input;
    const searchFields = this.inventorySearchFields;
    let query = this.supabase
      .from("product_variants")
      .select(
        "sku, product:products!inner(id, brand_id, name, model_id, category, condition, tenant_id, is_active, is_out_of_stock, archived_at, go_live_at)",
      )
      .eq("product.is_active", true);

    if (!includeUnpublished) {
      query = query.lte("product.go_live_at", nowIso);
    }

    if (filters.tenantId) {
      query = query.eq("product.tenant_id", filters.tenantId);
    }

    if (archivedStatus === "archived") {
      query = query.not("product.archived_at", "is", null);
    } else if (archivedStatus !== "all") {
      query = query.is("product.archived_at", null);
    }

    const shouldFilterOutOfStockProducts =
      filters.searchMode !== "inventory" &&
      (filters.stockStatus === "out_of_stock"
        ? false
        : filters.stockStatus === "in_stock"
          ? true
          : !Boolean(filters.includeOutOfStock));

    if (filters.stockStatus === "out_of_stock") {
      query = query.eq("product.is_out_of_stock", true);
    } else if (filters.stockStatus === "in_stock") {
      if (filters.searchMode !== "inventory") {
        query = query.eq("product.is_out_of_stock", false);
      }
    } else if (shouldFilterOutOfStockProducts) {
      query = query.eq("product.is_out_of_stock", false);
    }

    query = this.applyTextSearch(query, filters.q, searchFields, {
      foreignTable: "product",
    });
    if (filters.q?.trim()) {
      query = query.or(`sku.ilike.%${filters.q.trim().replace(/[(),]/g, " ")}%`);
    }

    if (filters.category?.length) {
      query = query.in("product.category", filters.category);
    }
    if (filters.brandIds?.length) {
      query = query.in("product.brand_id", filters.brandIds);
    }
    if (filters.modelIds?.length) {
      query = query.in("product.model_id", filters.modelIds);
    }
    if (filters.condition?.length) {
      query = query.in("product.condition", filters.condition);
    }

    const sizeProductIds = await this.listProductIdsForSizes(filters);
    if (Array.isArray(sizeProductIds)) {
      if (sizeProductIds.length === 0) {
        return 0;
      }
      query = query.in("product.id", sizeProductIds);
    }

    const { data, error } = await query.limit(20000);
    if (error) {
      throw error;
    }

    return new Set(
      (data ?? [])
        .map((row) => {
          const record = row as { sku?: string | null };
          return record.sku?.trim() ?? null;
        })
        .filter((sku): sku is string => Boolean(sku)),
    ).size;
  }

  private async countTotalInventoryUnits(input: {
    filters: ProductFilters;
    archivedStatus: ProductFilters["archivedStatus"];
    includeUnpublished: boolean;
    nowIso: string;
  }) {
    const { filters, archivedStatus, includeUnpublished, nowIso } = input;
    const searchFields = this.inventorySearchFields;
    let query = this.supabase
      .from("product_variants")
      .select(
        "stock, product:products!inner(id, brand_id, name, model_id, category, condition, tenant_id, is_active, is_out_of_stock, archived_at, go_live_at)",
      )
      .eq("product.is_active", true);

    if (!includeUnpublished) {
      query = query.lte("product.go_live_at", nowIso);
    }

    if (filters.tenantId) {
      query = query.eq("product.tenant_id", filters.tenantId);
    }

    if (archivedStatus === "archived") {
      query = query.not("product.archived_at", "is", null);
    } else if (archivedStatus !== "all") {
      query = query.is("product.archived_at", null);
    }

    const shouldFilterOutOfStockProducts =
      filters.searchMode !== "inventory" &&
      (filters.stockStatus === "out_of_stock"
        ? false
        : filters.stockStatus === "in_stock"
          ? true
          : !Boolean(filters.includeOutOfStock));

    if (filters.stockStatus === "out_of_stock") {
      query = query.eq("product.is_out_of_stock", true);
    } else if (filters.stockStatus === "in_stock") {
      if (filters.searchMode !== "inventory") {
        query = query.eq("product.is_out_of_stock", false);
      }
    } else if (shouldFilterOutOfStockProducts) {
      query = query.eq("product.is_out_of_stock", false);
    }

    query = this.applyTextSearch(query, filters.q, searchFields, {
      foreignTable: "product",
    });
    if (filters.q?.trim()) {
      query = query.or(`sku.ilike.%${filters.q.trim().replace(/[(),]/g, " ")}%`);
    }

    if (filters.category?.length) {
      query = query.in("product.category", filters.category);
    }
    if (filters.brandIds?.length) {
      query = query.in("product.brand_id", filters.brandIds);
    }
    if (filters.modelIds?.length) {
      query = query.in("product.model_id", filters.modelIds);
    }
    if (filters.condition?.length) {
      query = query.in("product.condition", filters.condition);
    }

    const sizeProductIds = await this.listProductIdsForSizes(filters);
    if (Array.isArray(sizeProductIds)) {
      if (sizeProductIds.length === 0) {
        return 0;
      }
      query = query.in("product.id", sizeProductIds);
    }

    const { data, error } = await query.limit(20000);
    if (error) {
      throw error;
    }

    return (data ?? []).reduce((sum, row) => {
      const record = row as { stock?: number | null };
      return sum + Number(record.stock ?? 0);
    }, 0);
  }

  async listIds(filters: ProductFilters = {}): Promise<string[]> {
    const includeUnpublished = filters.searchMode === "inventory";
    const nowIso = new Date().toISOString();
    const includeOutOfStock = Boolean(filters.includeOutOfStock);
    const archivedStatus = filters.archivedStatus ?? "active";
    const searchFields =
      filters.searchMode === "inventory"
        ? this.inventorySearchFields
        : this.storefrontSearchFields;

    let query = this.supabase.from("products").select("id").eq("is_active", true);
    query = this.applyArchivedFilter(query, archivedStatus);

    if (!includeUnpublished) {
      query = query.lte("go_live_at", nowIso);
    }

    if (filters.tenantId) {
      query = query.eq("tenant_id", filters.tenantId);
    }

    if (filters.stockStatus === "out_of_stock") {
      query = query.eq("is_out_of_stock", true);
    } else if (filters.stockStatus === "in_stock") {
      if (filters.searchMode !== "inventory") {
        query = query.eq("is_out_of_stock", false);
      }
    } else if (!includeOutOfStock) {
      query = query.eq("is_out_of_stock", false);
    }

    if (Array.isArray(filters.matchingProductIds)) {
      if (filters.matchingProductIds.length === 0) {
        return [];
      }
      query = query.in("id", filters.matchingProductIds);
    } else {
      query = this.applyTextSearch(query, filters.q, searchFields);
    }

    if (filters.category?.length) {
      query = query.in("category", filters.category);
    }
    if (filters.brandIds?.length) {
      query = query.in("brand_id", filters.brandIds);
    }
    if (filters.modelIds?.length) {
      query = query.in("model_id", filters.modelIds);
    }
    if (filters.condition?.length) {
      query = query.in("condition", filters.condition);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) {
      throw error;
    }

    return (data ?? []).map((row: { id: string }) => row.id);
  }

  async getById(
    id: string,
    opts?: Pick<ProductFilters, "tenantId" | "includeOutOfStock"> & {
      includeUnpublished?: boolean;
      includeInactive?: boolean;
      archivedStatus?: ProductFilters["archivedStatus"];
    },
  ): Promise<ProductWithDetails | null> {
    let query = this.supabase
      .from("products")
      .select(
        "*, brand:tag_brands(*), model:tag_models(*), variants:product_variants(*, size:tag_sizes(*)), images:product_images(*)",
      )
      .eq("id", id);
    if (!opts?.includeInactive) {
      query = query.eq("is_active", true);
    }
    query = this.applyArchivedFilter(query, opts?.archivedStatus ?? "active");

    if (!opts?.includeOutOfStock) {
      query = query.eq("is_out_of_stock", false);
    }
    if (!opts?.includeUnpublished) {
      query = query.lte("go_live_at", new Date().toISOString());
    }
    if (opts?.tenantId) {
      query = query.eq("tenant_id", opts.tenantId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    return this.transformProduct(data as ProductWithRelations);
  }

  async findByTitleAndCategory(
    titleRaw: string,
    category: string,
    tenantId?: string,
  ): Promise<ProductRow | null> {
    let query = this.supabase
      .from("products")
      .select("*")
      .eq("name", titleRaw)
      .eq("category", category)
      .eq("is_active", true)
      .is("archived_at", null);

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      throw error;
    }
    return data ?? null;
  }

  async create(product: ProductInsert) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("products")
      .insert({
        ...product,
        product_created_at: product.product_created_at ?? now,
        product_updated_at: product.product_updated_at ?? now,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data as ProductRow;
  }

  async update(id: string, product: ProductUpdate) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("products")
      .update({
        ...product,
        product_updated_at: product.product_updated_at ?? now,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data as ProductRow;
  }

  async delete(id: string) {
    const { error } = await this.supabase.from("products").delete().eq("id", id);
    if (error) {
      throw error;
    }
  }

  async archive(id: string) {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("products")
      .update({ archived_at: now, is_out_of_stock: true, product_updated_at: now })
      .eq("id", id);

    if (error) {
      throw error;
    }
  }

  async restore(id: string) {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("products")
      .update({ archived_at: null, product_updated_at: now })
      .eq("id", id);

    if (error) {
      throw error;
    }
  }

  async restoreMany(ids: string[]) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return 0;
    }

    let restoredCount = 0;

    for (let index = 0; index < uniqueIds.length; index += BULK_MUTATION_BATCH_SIZE) {
      const batch = uniqueIds.slice(index, index + BULK_MUTATION_BATCH_SIZE);
      const { data, error } = await this.supabase
        .from("products")
        .update({
          archived_at: null,
          product_updated_at: new Date().toISOString(),
        })
        .in("id", batch)
        .select("id");

      if (error) {
        throw error;
      }

      restoredCount += (data ?? []).length;
    }

    return restoredCount;
  }

  async archiveMany(ids: string[]) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return 0;
    }

    let archivedCount = 0;
    const archivedAt = new Date().toISOString();

    for (let index = 0; index < uniqueIds.length; index += BULK_MUTATION_BATCH_SIZE) {
      const batch = uniqueIds.slice(index, index + BULK_MUTATION_BATCH_SIZE);
      const { data, error } = await this.supabase
        .from("products")
        .update({
          archived_at: archivedAt,
          is_out_of_stock: true,
          product_updated_at: archivedAt,
        })
        .in("id", batch)
        .select("id");

      if (error) {
        throw error;
      }

      archivedCount += (data ?? []).length;
    }

    return archivedCount;
  }

  async countOrderItemsForProduct(productId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId);

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  async listVariantSkus(tenantId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("product_variants")
      .select("sku")
      .eq("tenant_id", tenantId);

    if (error) {
      throw error;
    }

    return (data ?? [])
      .map((row) => row.sku)
      .filter((sku): sku is string => typeof sku === "string" && sku.trim().length > 0);
  }

  async createVariant(variant: VariantInsert) {
    const { data, error } = await this.supabase
      .from("product_variants")
      .insert(variant)
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data as VariantRow;
  }

  async updateVariant(id: string, variant: VariantUpdate) {
    const { data, error } = await this.supabase
      .from("product_variants")
      .update(variant)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data as VariantRow;
  }

  async deleteVariantsByProduct(productId: string) {
    const { error } = await this.supabase
      .from("product_variants")
      .delete()
      .eq("product_id", productId);

    if (error) {
      throw error;
    }
  }

  async deleteVariant(id: string) {
    const { error } = await this.supabase.from("product_variants").delete().eq("id", id);

    if (error) {
      throw error;
    }
  }

  async deleteAbandonedOrderItems(variantIds: string[]) {
    if (variantIds.length === 0) {
      return;
    }

    // First, get order_items for these variants that are in pending/canceled orders
    const { data: itemsToDelete, error: selectError } = await this.supabase
      .from("order_items")
      .select("id, order:orders!inner(status)")
      .in("variant_id", variantIds)
      .in("order.status", ["pending", "canceled"]);

    if (selectError) {
      throw selectError;
    }

    if (!itemsToDelete || itemsToDelete.length === 0) {
      return;
    }

    // Delete these order_items
    const itemIds = itemsToDelete.map((item) => item.id);
    const { error: deleteError } = await this.supabase
      .from("order_items")
      .delete()
      .in("id", itemIds);

    if (deleteError) {
      throw deleteError;
    }
  }

  async listReferencedVariantIds(variantIds: string[]) {
    if (variantIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from("order_items")
      .select("variant_id, order:orders!inner(status)")
      .in("variant_id", variantIds)
      .in("order.status", ["paid", "shipped"]);

    if (error) {
      throw error;
    }

    return [
      ...new Set(
        (data ?? [])
          .map((row) => row.variant_id)
          .filter((variantId): variantId is string => Boolean(variantId)),
      ),
    ];
  }

  async createImage(image: ImageInsert) {
    const { data, error } = await this.supabase
      .from("product_images")
      .insert(image)
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data as ImageRow;
  }

  async deleteImagesByProduct(productId: string) {
    const { error } = await this.supabase
      .from("product_images")
      .delete()
      .eq("product_id", productId);

    if (error) {
      throw error;
    }
  }

  async getBrands(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("tag_brands")
      .select("canonical_label")
      .eq("is_active", true)
      .order("canonical_label");

    if (error) {
      throw error;
    }
    return (data ?? []).map((brand) => brand.canonical_label);
  }

  async listFilterData(opts?: {
    includeOutOfStock?: boolean;
  }): Promise<ProductFilterData[]> {
    const includeOutOfStock = Boolean(opts?.includeOutOfStock);
    const rows: FilterDataRow[] = [];
    let rangeStart = 0;

    while (true) {
      let query = this.supabase
        .from("products")
        .select(
          "id, brand_id, model_id, category, brand:tag_brands(canonical_label), model:tag_models(canonical_label)",
        )
        .eq("is_active", true)
        .lte("go_live_at", new Date().toISOString())
        .order("id", { ascending: true });

      if (!includeOutOfStock) {
        query = query.eq("is_out_of_stock", false);
      }

      const { data, error } = await query.range(
        rangeStart,
        rangeStart + QUERY_PAGE_SIZE - 1,
      );
      if (error) {
        throw error;
      }

      const batch = (data ?? []) as FilterDataRow[];
      rows.push(...batch);
      if (batch.length < QUERY_PAGE_SIZE) {
        break;
      }
      rangeStart += QUERY_PAGE_SIZE;
    }

    return rows.map((row) => ({
      brandId: row.brand_id,
      brand: row.brand?.canonical_label ?? "",
      modelId: row.model_id,
      model: row.model?.canonical_label ?? null,
      category: row.category ?? null,
    }));
  }

  async listAvailableSizes(filters?: ProductFilters) {
    const includeOutOfStock = Boolean(filters?.includeOutOfStock);
    const rows: SizeAvailabilityRow[] = [];
    let rangeStart = 0;

    while (true) {
      let query = this.supabase
        .from("product_variants")
        .select(
          "id, product_id, size_id, size:tag_sizes(canonical_label), product:products!inner(size_type, is_active, is_out_of_stock)",
        )
        .gt("stock", 0)
        .eq("product.is_active", true)
        .lte("product.go_live_at", new Date().toISOString())
        .order("id", { ascending: true });

      if (filters?.tenantId) {
        query = query.eq("product.tenant_id", filters.tenantId);
      }

      if (filters?.stockStatus === "out_of_stock") {
        query = query.eq("product.is_out_of_stock", true);
      } else if (filters?.stockStatus === "in_stock") {
        query = query.eq("product.is_out_of_stock", false);
      } else if (!includeOutOfStock) {
        query = query.eq("product.is_out_of_stock", false);
      }

      if (Array.isArray(filters?.matchingProductIds)) {
        if (filters.matchingProductIds.length === 0) {
          break;
        }
        query = query.in("product.id", filters.matchingProductIds);
      } else {
        query = this.applyTextSearch(query, filters?.q, this.storefrontSearchFields, {
          foreignTable: "product",
        });
      }

      if (filters?.category?.length) {
        query = query.in("product.category", filters.category);
      }
      if (filters?.brandIds?.length) {
        query = query.in("product.brand_id", filters.brandIds);
      }
      if (filters?.modelIds?.length) {
        query = query.in("product.model_id", filters.modelIds);
      }
      if (filters?.condition?.length) {
        query = query.in("product.condition", filters.condition);
      }

      const { data, error } = await query.range(
        rangeStart,
        rangeStart + QUERY_PAGE_SIZE - 1,
      );
      if (error) {
        throw error;
      }

      const batch = (data ?? []) as SizeAvailabilityRow[];
      rows.push(...batch);
      if (batch.length < QUERY_PAGE_SIZE) {
        break;
      }
      rangeStart += QUERY_PAGE_SIZE;
    }

    const shoeProductsBySize = new Map<
      string,
      { label: string; products: Set<string> }
    >();
    const clothingProductsBySize = new Map<
      string,
      { label: string; products: Set<string> }
    >();

    for (const row of rows) {
      const sizeLabel = row.size?.canonical_label?.trim();
      if (!sizeLabel) {
        continue;
      }
      const target =
        row.product?.size_type === "shoe"
          ? shoeProductsBySize
          : row.product?.size_type === "clothing"
            ? clothingProductsBySize
            : null;
      if (!target) {
        continue;
      }
      const entry = target.get(row.size_id) ?? {
        label: sizeLabel,
        products: new Set<string>(),
      };
      entry.products.add(row.product_id);
      target.set(row.size_id, entry);
    }

    const shoe = Array.from(shoeProductsBySize, ([id, entry]) => ({
      id,
      label: entry.label,
    }));
    const clothing = Array.from(clothingProductsBySize, ([id, entry]) => ({
      id,
      label: entry.label,
    }));
    return {
      shoe,
      clothing,
      shoeCounts: Object.fromEntries(
        shoe.map((size) => [
          size.id,
          shoeProductsBySize.get(size.id)?.products.size ?? 0,
        ]),
      ),
      clothingCounts: Object.fromEntries(
        clothing.map((size) => [
          size.id,
          clothingProductsBySize.get(size.id)?.products.size ?? 0,
        ]),
      ),
    };
  }

  async listAvailableConditions(filters?: ProductFilters) {
    const includeOutOfStock = Boolean(filters?.includeOutOfStock);
    let query = this.supabase
      .from("product_variants")
      .select(
        "size_id, product:products!inner(size_type, condition, is_active, is_out_of_stock)",
      )
      .gt("stock", 0)
      .eq("product.is_active", true)
      .lte("product.go_live_at", new Date().toISOString());

    if (filters?.tenantId) {
      query = query.eq("product.tenant_id", filters.tenantId);
    }

    if (filters?.stockStatus === "out_of_stock") {
      query = query.eq("product.is_out_of_stock", true);
    } else if (filters?.stockStatus === "in_stock") {
      query = query.eq("product.is_out_of_stock", false);
    } else if (!includeOutOfStock) {
      query = query.eq("product.is_out_of_stock", false);
    }

    if (Array.isArray(filters?.matchingProductIds)) {
      if (filters.matchingProductIds.length === 0) {
        return [];
      }
      query = query.in("product.id", filters.matchingProductIds);
    } else {
      query = this.applyTextSearch(query, filters?.q, this.storefrontSearchFields, {
        foreignTable: "product",
      });
    }

    if (filters?.category?.length) {
      query = query.in("product.category", filters.category);
    }
    if (filters?.brandIds?.length) {
      query = query.in("product.brand_id", filters.brandIds);
    }
    if (filters?.modelIds?.length) {
      query = query.in("product.model_id", filters.modelIds);
    }
    if (filters?.condition?.length) {
      query = query.in("product.condition", filters.condition);
    }

    const { data, error } = await query.limit(5000);

    if (error) {
      throw error;
    }

    const conditions = new Set<string>();
    for (const row of (data ?? []) as Array<{
      product?: { condition?: string | null };
    }>) {
      const condition = row?.product?.condition;
      if (condition) {
        conditions.add(condition);
      }
    }

    return Array.from(conditions);
  }

  private transformProduct(raw: ProductWithRelations): ProductWithDetails {
    const variants = Array.isArray(raw.variants) ? raw.variants : [];
    const images = Array.isArray(raw.images) ? raw.images : [];
    if (!raw.brand) {
      throw new Error(`Product ${raw.id} is missing its brand relation.`);
    }

    return {
      ...(raw as ProductRow),
      brand: { id: raw.brand.id, label: raw.brand.canonical_label },
      model: raw.model ? { id: raw.model.id, label: raw.model.canonical_label } : null,
      variants: variants
        .map((variant) => {
          if (!variant.size) {
            throw new Error(`Variant ${variant.id} is missing its size relation.`);
          }
          return {
            ...variant,
            size: { id: variant.size.id, label: variant.size.canonical_label },
          };
        })
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      images: (images as ImageRow[]).sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      ),
    };
  }

  private applyTextSearch<
    Query extends {
      or: (
        filters: string,
        opts?: { foreignTable?: string; referencedTable?: string },
      ) => Query;
    },
  >(
    query: Query,
    input: string | undefined,
    fields: string[],
    opts?: { foreignTable?: string; referencedTable?: string },
  ): Query {
    const terms = this.buildSearchTerms(input);
    if (terms.length === 0) {
      return query;
    }

    const clauses: string[] = [];
    for (const term of terms) {
      const safe = term.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
      if (!safe) {
        continue;
      }
      for (const field of fields) {
        clauses.push(`${field}.ilike.%${safe}%`);
      }
    }

    if (clauses.length === 0) {
      return query;
    }

    return query.or(clauses.join(","), opts) as Query;
  }

  private buildSearchTerms(input?: string): string[] {
    if (!input) {
      return [];
    }

    const normalized = input.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const terms = new Set<string>();
    const addTerm = (value: string) => {
      const next = value.trim();
      if (next.length >= 2) {
        terms.add(next);
      }
    };

    addTerm(normalized);

    const tokens = normalized.split(/\s+/);
    for (const token of tokens) {
      const cleaned = token.replace(/[^a-z0-9]/g, "");
      if (!cleaned) {
        continue;
      }

      addTerm(cleaned);

      if (cleaned.endsWith("ies") && cleaned.length > 4) {
        addTerm(`${cleaned.slice(0, -3)}y`);
      } else if (cleaned.endsWith("es") && cleaned.length > 4) {
        addTerm(cleaned.slice(0, -2));
      } else if (cleaned.endsWith("s") && cleaned.length > 3) {
        addTerm(cleaned.slice(0, -1));
      }
    }

    return Array.from(terms).slice(0, 8);
  }

  private buildInClause(values: string[]) {
    return values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");
  }

  /**
   * Calculate a relevance score for a product based on search terms.
   * Higher scores indicate better matches.
   */
  private calculateSearchRelevance(
    product: SearchableProductRow,
    searchQuery: string | undefined,
    searchFields: string[],
  ): number {
    if (!searchQuery?.trim()) {
      return 0;
    }

    const query = searchQuery.trim().toLowerCase();
    const terms = this.buildSearchTerms(searchQuery);

    // Filter out the full phrase from individual terms to avoid double-counting
    const individualTerms = terms.filter((term) => term !== query);

    let score = 0;

    // Helper to get field values
    const getFieldValue = (field: string): string => {
      const value = product[field as keyof SearchableProductRow];
      return String(value ?? "").toLowerCase();
    };

    // Check each search field
    for (const field of searchFields) {
      const fieldValue = getFieldValue(field);
      if (!fieldValue) {
        continue;
      }

      // Exact match bonus (highest priority)
      if (fieldValue === query) {
        score += 1000;
        continue; // Skip other checks for exact matches
      }

      // Starts with query bonus
      if (fieldValue.startsWith(query)) {
        score += 500;
      }

      // Contains full query bonus (exact phrase)
      if (fieldValue.includes(query)) {
        score += 300;
      }

      // Count matching individual terms (excluding the full phrase)
      let matchingTerms = 0;
      for (const term of individualTerms) {
        if (fieldValue.includes(term)) {
          matchingTerms++;
        }
      }

      // Strong bonus for matching ALL individual terms (even if not exact phrase)
      if (individualTerms.length > 0 && matchingTerms === individualTerms.length) {
        score += 200;
      }

      // Bonus for each matching term (more important now)
      score += matchingTerms * 25;

      // Check for terms appearing in sequence (even with words between)
      if (individualTerms.length > 1) {
        let sequenceBonus = 0;
        for (let i = 0; i < individualTerms.length - 1; i++) {
          const term1Idx = fieldValue.indexOf(individualTerms[i]);
          const term2Idx = fieldValue.indexOf(individualTerms[i + 1]);
          if (term1Idx !== -1 && term2Idx > term1Idx) {
            sequenceBonus += 15;
          }
        }
        score += sequenceBonus;
      }

      // Product name is the raw title and primary inventory search field.
      if (field === "name") {
        score *= 1.5;
      }
    }

    return score;
  }

  private async listProductIdsByPrice(
    filters: ProductFilters,
    sort: "price_asc" | "price_desc",
    includeOutOfStock: boolean,
    includeUnpublished: boolean,
    nowIso: string,
  ) {
    const { page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const hasSizeFilters = Boolean(filters.sizeIds?.length);

    const sizeProductIds = hasSizeFilters
      ? await this.listProductIdsForSizes(filters)
      : null;
    if (Array.isArray(sizeProductIds) && sizeProductIds.length === 0) {
      return { ids: [], total: 0 };
    }

    const hasPriceFilter =
      typeof filters.priceMinCents === "number" ||
      typeof filters.priceMaxCents === "number";
    let countQuery = this.supabase
      .from("products")
      .select(hasPriceFilter ? "id, product_variants!inner(id)" : "id", {
        count: "exact",
        head: true,
      })
      .eq("is_active", true);

    if (!includeUnpublished) {
      countQuery = countQuery.lte("go_live_at", nowIso);
    }

    // Tenant scoping
    if (filters.tenantId) {
      countQuery = countQuery.eq("tenant_id", filters.tenantId);
    }

    if (filters.stockStatus === "out_of_stock") {
      countQuery = countQuery.eq("is_out_of_stock", true);
    } else if (filters.stockStatus === "in_stock") {
      countQuery = countQuery.eq("is_out_of_stock", false);
    } else if (!includeOutOfStock) {
      countQuery = countQuery.eq("is_out_of_stock", false);
    }

    // Text search
    if (Array.isArray(filters.matchingProductIds)) {
      if (filters.matchingProductIds.length === 0) {
        return { ids: [], total: 0 };
      }
      countQuery = countQuery.in("id", filters.matchingProductIds);
    } else {
      countQuery = this.applyTextSearch(
        countQuery,
        filters.q,
        this.storefrontSearchFields,
      );
    }

    // Category / brand / condition filters
    if (filters.category?.length) {
      countQuery = countQuery.in("category", filters.category);
    }
    if (filters.brandIds?.length) {
      countQuery = countQuery.in("brand_id", filters.brandIds);
    }
    if (filters.modelIds?.length) {
      countQuery = countQuery.in("model_id", filters.modelIds);
    }
    if (filters.condition?.length) {
      countQuery = countQuery.in("condition", filters.condition);
    }
    if (Array.isArray(sizeProductIds)) {
      countQuery = countQuery.in("id", sizeProductIds);
    }
    if (hasPriceFilter) {
      countQuery = countQuery.gt("product_variants.stock", 0);
      if (typeof filters.priceMinCents === "number") {
        countQuery = countQuery.gte(
          "product_variants.sale_price_cents",
          filters.priceMinCents,
        );
      }
      if (typeof filters.priceMaxCents === "number") {
        countQuery = countQuery.lte(
          "product_variants.sale_price_cents",
          filters.priceMaxCents,
        );
      }
    }

    const { count: total, error: countError } = await countQuery;
    if (countError) {
      throw countError;
    }
    if (!total) {
      return { ids: [], total: 0 };
    }

    const targetCount = offset + limit;
    const batchSize = Math.max(limit * 6, 120);
    const orderedIds: string[] = [];
    const seen = new Set<string>();
    let rangeStart = 0;

    while (orderedIds.length < targetCount) {
      let query = this.supabase
        .from("product_variants")
        .select("product_id, sale_price_cents, product:products!inner(id)")
        .order("sale_price_cents", { ascending: sort === "price_asc" })
        .order("product_id", { ascending: true })
        .range(rangeStart, rangeStart + batchSize - 1);

      if (!includeOutOfStock) {
        query = query.gt("stock", 0);
      }

      if (Array.isArray(sizeProductIds)) {
        query = query.in("product_id", sizeProductIds);
      }
      if (Array.isArray(filters.matchingProductIds)) {
        query = query.in("product_id", filters.matchingProductIds);
      }

      if (typeof filters.priceMinCents === "number") {
        query = query.gte("sale_price_cents", filters.priceMinCents);
      }
      if (typeof filters.priceMaxCents === "number") {
        query = query.lte("sale_price_cents", filters.priceMaxCents);
      }

      // Tenant scoping
      if (filters.tenantId) {
        query = query.eq("product.tenant_id", filters.tenantId);
      }

      if (filters.stockStatus === "out_of_stock") {
        query = query.eq("product.is_out_of_stock", true);
      } else if (filters.stockStatus === "in_stock") {
        query = query.eq("product.is_out_of_stock", false);
      } else if (!includeOutOfStock) {
        query = query.eq("product.is_out_of_stock", false);
      }

      query = query.eq("product.is_active", true);
      if (!includeUnpublished) {
        query = query.lte("product.go_live_at", nowIso);
      }

      // Text search on product fields
      if (!Array.isArray(filters.matchingProductIds)) {
        query = this.applyTextSearch(query, filters.q, this.storefrontSearchFields, {
          foreignTable: "product",
        });
      }

      // Category / brand / condition filters
      if (filters.category?.length) {
        query = query.in("product.category", filters.category);
      }
      if (filters.brandIds?.length) {
        query = query.in("product.brand_id", filters.brandIds);
      }
      if (filters.modelIds?.length) {
        query = query.in("product.model_id", filters.modelIds);
      }
      if (filters.condition?.length) {
        query = query.in("product.condition", filters.condition);
      }

      const { data, error } = await query;
      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const row of data ?? []) {
        const variantRow = row as VariantWithProduct;
        const productId = variantRow.product_id;
        if (!productId || seen.has(productId)) {
          continue;
        }
        seen.add(productId);
        orderedIds.push(productId);
        if (orderedIds.length >= targetCount) {
          break;
        }
      }

      if (data.length < batchSize) {
        break;
      }
      rangeStart += batchSize;
    }

    return { ids: orderedIds.slice(offset, offset + limit), total };
  }

  private async listProductIdsForSizes(filters: ProductFilters) {
    const selectedSizeIds = filters.sizeIds ?? [];

    if (selectedSizeIds.length === 0) {
      return null;
    }

    const productIds = new Set<string>();

    {
      let rangeStart = 0;

      while (true) {
        let query = this.supabase
          .from("product_variants")
          .select("id, product_id")
          .in("size_id", selectedSizeIds)
          .gt("stock", 0)
          .order("id", { ascending: true });

        if (filters.tenantId) {
          query = query.eq("tenant_id", filters.tenantId);
        }

        const { data, error } = await query.range(
          rangeStart,
          rangeStart + QUERY_PAGE_SIZE - 1,
        );
        if (error) {
          throw error;
        }

        for (const row of data ?? []) {
          if (row.product_id) {
            productIds.add(row.product_id);
          }
        }
        if ((data?.length ?? 0) < QUERY_PAGE_SIZE) {
          break;
        }
        rangeStart += QUERY_PAGE_SIZE;
      }
    }

    return Array.from(productIds);
  }

  async getProductsForCheckout(productIds: string[]): Promise<
    Array<{
      id: string;
      name: string;
      brand: string;
      model: string | null;
      titleDisplay: string;
      category: string;
      condition: string;
      tenantId: string | null;
      shippingPriceCents: number | null;
      variants: Array<{
        id: string;
        sku: string;
        sizeLabel: string;
        salePriceCents: number;
        unitCostCents: number;
        stock: number;
      }>;
    }>
  > {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("products")
      .select(
        "id, name, brand_id, model_id, brand:tag_brands(canonical_label), model:tag_models(canonical_label), category, condition, tenant_id, shipping_price_cents, variants:product_variants(id, sku, size_id, size:tag_sizes(canonical_label), sale_price_cents, unit_cost_cents, stock)",
      )
      .in("id", productIds)
      .eq("is_active", true)
      .eq("is_out_of_stock", false)
      .lte("go_live_at", nowIso);

    if (error) {
      throw error;
    }

    return (data ?? []).map((p: CheckoutProductRow) => ({
      id: p.id,
      name: p.name,
      brand: p.brand?.canonical_label ?? "",
      model: p.model?.canonical_label ?? null,
      titleDisplay: p.name,
      category: p.category,
      condition: p.condition,
      tenantId: p.tenant_id ?? null,
      shippingPriceCents: p.shipping_price_cents ?? null,
      variants: (p.variants ?? []).map((v) => ({
        id: v.id,
        sku: v.sku,
        sizeLabel: v.size?.canonical_label ?? "",
        salePriceCents: v.sale_price_cents,
        unitCostCents: v.unit_cost_cents,
        stock: v.stock,
      })),
    }));
  }

  async getVariantsForCart(variantIds: string[]): Promise<CartVariantDetails[]> {
    if (variantIds.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from("product_variants")
      .select(
        "id, product_id, sku, size_id, size:tag_sizes(canonical_label), sale_price_cents, stock, product:products(id, brand_id, brand:tag_brands(canonical_label), name, is_active, is_out_of_stock, go_live_at)",
      )
      .in("id", variantIds);

    if (error) {
      throw error;
    }

    const rows = data ?? [];
    const productIds = [
      ...new Set(
        rows
          .map((row: CartVariantRow) => row.product?.id ?? row.product_id)
          .filter((id: string | null): id is string => Boolean(id)),
      ),
    ];

    const imageMap = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: images, error: imagesError } = await this.supabase
        .from("product_images")
        .select("product_id, url, is_primary, sort_order")
        .in("product_id", productIds)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true });

      if (imagesError) {
        throw imagesError;
      }

      for (const image of images ?? []) {
        const img = image as ProductImageRow;
        if (!imageMap.has(img.product_id)) {
          imageMap.set(img.product_id, img.url);
        }
      }
    }

    const now = Date.now();

    return rows.map((row: CartVariantRow) => {
      const product = row.product;
      const goLiveAt = product?.go_live_at ? Date.parse(product.go_live_at) : Number.NaN;
      const isLive = Number.isFinite(goLiveAt) && goLiveAt <= now;
      return {
        variantId: row.id,
        productId: product?.id ?? row.product_id,
        sizeLabel: row.size?.canonical_label ?? "",
        priceCents: row.sale_price_cents,
        sku: row.sku,
        stock: row.stock,
        brand: product?.brand?.canonical_label ?? "",
        name: product?.name ?? "",
        titleDisplay: product?.name ?? "",
        isActive: (product?.is_active ?? false) && isLive,
        isOutOfStock: product?.is_out_of_stock ?? false,
        imageUrl: imageMap.get(product?.id ?? row.product_id) ?? null,
      };
    });
  }

  async getModels(category?: string): Promise<string[]> {
    const query = this.supabase
      .from("tag_models")
      .select("canonical_label")
      .eq("is_active", true)
      .order("canonical_label");

    const { data, error } = await query;
    if (error) {
      throw error;
    }
    void category;
    return (data ?? []).map((model) => model.canonical_label);
  }
}
