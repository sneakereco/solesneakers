import Link from "next/link";

import { ProductGrid } from "@/components/store/ProductGrid";
import { StoreControls } from "@/components/store/StoreControls";
import { StorefrontFilterBar } from "@/components/store/StorefrontFilterBar";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { storeProductsQuerySchema } from "@/lib/validation/storefront";
import type { ProductFilters } from "@/repositories/product-repo";
import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";
import { StorefrontService } from "@/services/storefront-service";

export const revalidate = 60;

type StoreSearchParams = Record<string, string | string[] | undefined>;

const getArrayParam = (searchParams: StoreSearchParams | undefined, key: string) => {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return typeof value === "string" && value.trim() ? [value] : [];
};

const getStringParam = (searchParams: StoreSearchParams | undefined, key: string) => {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
};

const getPositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getNonNegativeInteger = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const formatLabel = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

const formatPriceLabel = (min?: number, max?: number) => {
  if (typeof min === "number" && typeof max === "number") {
    return `$${min} - $${max}`;
  }
  if (typeof min === "number") {
    return `$${min} and Up`;
  }
  if (typeof max === "number") {
    return `Under $${max + 1}`;
  }
  return null;
};

export default async function StorePage({
  searchParams,
}: {
  searchParams?: Promise<StoreSearchParams> | StoreSearchParams;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const query = getStringParam(resolvedSearchParams, "q")?.trim() ?? "";
  const priceMin = getNonNegativeInteger(
    getStringParam(resolvedSearchParams, "priceMin"),
  );
  const priceMax = getNonNegativeInteger(
    getStringParam(resolvedSearchParams, "priceMax"),
  );
  const requestedSort = getStringParam(resolvedSearchParams, "sort")?.trim();
  const requestedView = getStringParam(resolvedSearchParams, "view");
  const view: "grid" | "list" = requestedView === "list" ? "list" : "grid";

  const rawFilters = {
    q: query || undefined,
    category: getArrayParam(resolvedSearchParams, "category"),
    brandIds: getArrayParam(resolvedSearchParams, "brandIds"),
    modelIds: getArrayParam(resolvedSearchParams, "modelIds"),
    sizeIds: getArrayParam(resolvedSearchParams, "sizeIds"),
    condition: getArrayParam(resolvedSearchParams, "condition"),
    priceMinCents: typeof priceMin === "number" ? priceMin * 100 : undefined,
    priceMaxCents: typeof priceMax === "number" ? priceMax * 100 : undefined,
    sort: requestedSort || (query ? "relevance" : "newest"),
    page: getPositiveInteger(getStringParam(resolvedSearchParams, "page"), 1),
    limit: getPositiveInteger(getStringParam(resolvedSearchParams, "limit"), 24),
  };

  const parsed = storeProductsQuerySchema.safeParse(rawFilters);
  const filters: ProductFilters = parsed.success
    ? parsed.data
    : {
        ...rawFilters,
        sort: query ? "relevance" : "newest",
        page: 1,
        limit: 24,
        includeOutOfStock: false,
      };

  const storeQueryParams = new URLSearchParams();
  Object.entries(resolvedSearchParams ?? {}).forEach(([key, value]) => {
    if (!value || key === "from") {
      return;
    }
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((entry) => storeQueryParams.append(key, entry));
    } else if (value.trim()) {
      storeQueryParams.append(key, value);
    }
  });
  const storeHref = storeQueryParams.size > 0 ? `/store?${storeQueryParams}` : "/store";

  const supabase = createSupabasePublicClient();
  const service = new StorefrontService(supabase);
  const taxonomyRepo = new TagTaxonomyRepository(supabase);
  const [initialProductsResult, filterData, taxonomyBrands] = await Promise.all([
    service.listProducts(filters),
    service.listFilters({ filters }),
    taxonomyRepo.listBrands(),
  ]);

  let productsResult = initialProductsResult;
  let pageCount = Math.max(1, Math.ceil(productsResult.total / productsResult.limit));
  if (productsResult.total > 0 && productsResult.page > pageCount) {
    productsResult = await service.listProducts({ ...filters, page: pageCount });
    pageCount = Math.max(1, Math.ceil(productsResult.total / productsResult.limit));
  }

  const selectedCategories = filters.category ?? [];
  const selectedBrandIds = filters.brandIds ?? [];
  const selectedModelIds = filters.modelIds ?? [];
  const selectedSizeIds = filters.sizeIds ?? [];
  const selectedConditions = filters.condition ?? [];
  const priceLabel = formatPriceLabel(priceMin, priceMax);
  const facetLabels = new Map(
    [
      ...taxonomyBrands.map((brand) => ({
        id: brand.id,
        label: brand.canonical_label,
      })),
      ...filterData.brands,
      ...filterData.models,
      ...filterData.availableShoeSizes,
      ...filterData.availableClothingSizes,
    ].map((option) => [option.id, option.label]),
  );
  const activeFilterLabels = Array.from(
    new Set([
      ...selectedCategories.map(formatLabel),
      ...selectedBrandIds.map((id) => facetLabels.get(id) ?? id),
      ...selectedModelIds.map((id) => facetLabels.get(id) ?? id),
      ...selectedSizeIds.map((id) => facetLabels.get(id) ?? id),
      ...selectedConditions.map(formatLabel),
      ...(priceLabel ? [priceLabel] : []),
    ]),
  );

  const browseLabel = query
    ? `Search: "${query}"`
    : activeFilterLabels.length === 0
      ? "New Arrivals"
      : activeFilterLabels.length === 1
        ? activeFilterLabels[0]
        : "Filtered Collection";

  return (
    <div className="min-h-screen bg-[var(--storefront-surface)] text-black">
      <section className="relative min-h-[190px] border-b border-zinc-300 px-5 sm:px-8 lg:px-12">
        <nav
          className="flex items-center gap-2 pt-6 text-[0.62rem] uppercase tracking-[0.08em] text-zinc-500"
          aria-label="Breadcrumb"
        >
          <Link href="/" className="transition-colors hover:text-black">
            Home
          </Link>
          <span>/</span>
          <Link href="/store" className="transition-colors hover:text-black">
            Shop
          </Link>
          <span>/</span>
          <span>{browseLabel}</span>
        </nav>
        <div className="flex justify-center px-4 pb-12 pt-9 text-center">
          <h1 className="text-3xl font-medium uppercase tracking-[0.025em] text-zinc-950 sm:text-[2rem]">
            {browseLabel}
          </h1>
        </div>
      </section>

      <StoreControls
        total={productsResult.total}
        page={productsResult.page}
        pageCount={pageCount}
        limit={productsResult.limit}
        sort={filters.sort ?? "newest"}
        view={view}
        showPagination={false}
      />

      <StorefrontFilterBar
        brands={filterData.brands}
        categories={filterData.categories}
        conditions={filterData.availableConditions}
        shoeSizes={filterData.availableShoeSizes}
        clothingSizes={filterData.availableClothingSizes}
        shoeSizeCounts={filterData.shoeSizeCounts}
        clothingSizeCounts={filterData.clothingSizeCounts}
        selectedBrandIds={selectedBrandIds}
        selectedCategories={selectedCategories}
        selectedConditions={selectedConditions}
        selectedSizeIds={selectedSizeIds}
        priceMin={priceMin}
        priceMax={priceMax}
      />

      <section
        className={
          view === "list"
            ? "px-3 py-8 sm:px-6 lg:px-10 lg:py-12"
            : "px-3 py-12 sm:px-6 lg:px-10 lg:py-16"
        }
      >
        <ProductGrid
          products={productsResult.products}
          storeHref={storeHref}
          view={view}
        />
      </section>

      <StoreControls
        total={productsResult.total}
        page={productsResult.page}
        pageCount={pageCount}
        limit={productsResult.limit}
        sort={filters.sort ?? "newest"}
        view={view}
        showSortControls={false}
      />
    </div>
  );
}
