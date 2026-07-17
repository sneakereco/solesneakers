"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, X } from "lucide-react";

type FilterOption = {
  label: string;
  value: string;
  param: "brand" | "condition" | "category" | "sizeShoe" | "sizeClothing";
  count?: number;
  group?: string;
};

type PricePreset = {
  label: string;
  min?: number;
  max?: number;
};

type StorefrontFilterBarProps = {
  brands: string[];
  categories: string[];
  conditions: string[];
  shoeSizes: string[];
  clothingSizes: string[];
  shoeSizeCounts: Record<string, number>;
  clothingSizeCounts: Record<string, number>;
  selectedBrands: string[];
  selectedCategories: string[];
  selectedConditions: string[];
  selectedShoeSizes: string[];
  selectedClothingSizes: string[];
  priceMin?: number;
  priceMax?: number;
};

const PRICE_PRESETS: PricePreset[] = [
  { label: "Under $50", max: 49 },
  { label: "$50 - $100", min: 50, max: 100 },
  { label: "$100 - $200", min: 100, max: 200 },
  { label: "$200 - $500", min: 200, max: 500 },
  { label: "$500 and up", min: 500 },
];

const FILTER_QUERY_KEYS = [
  "brand",
  "condition",
  "category",
  "sizeShoe",
  "sizeClothing",
  "priceMin",
  "priceMax",
  "model",
];

const naturalCompare = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

const formatLabel = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

export function StorefrontFilterBar({
  brands,
  categories,
  conditions,
  shoeSizes,
  clothingSizes,
  shoeSizeCounts,
  clothingSizeCounts,
  selectedBrands,
  selectedCategories,
  selectedConditions,
  selectedShoeSizes,
  selectedClothingSizes,
  priceMin,
  priceMax,
}: StorefrontFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [openFacet, setOpenFacet] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!openFacet) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpenFacet(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFacet(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openFacet]);

  const pushParams = (params: URLSearchParams) => {
    params.set("page", "1");
    startTransition(() => router.push(`/store?${params.toString()}`));
  };

  const toggleOption = (option: FilterOption) => {
    const params = new URLSearchParams(searchParams.toString());
    const current = params.getAll(option.param);
    const next = current.includes(option.value)
      ? current.filter((value) => value !== option.value)
      : [...current, option.value];
    params.delete(option.param);
    next.forEach((value) => params.append(option.param, value));
    pushParams(params);
  };

  const selectPrice = (preset: PricePreset | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("priceMin");
    params.delete("priceMax");
    if (typeof preset?.min === "number") {
      params.set("priceMin", String(preset.min));
    }
    if (typeof preset?.max === "number") {
      params.set("priceMax", String(preset.max));
    }
    pushParams(params);
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    FILTER_QUERY_KEYS.forEach((key) => params.delete(key));
    pushParams(params);
  };

  const brandOptions: FilterOption[] = [...brands].sort(naturalCompare).map((value) => ({
    label: value,
    value,
    param: "brand",
  }));
  const conditionOptions: FilterOption[] = conditions.map((value) => ({
    label: value === "used" ? "Pre-owned" : formatLabel(value),
    value,
    param: "condition",
  }));
  const categoryOptions: FilterOption[] = categories.map((value) => ({
    label: formatLabel(value),
    value,
    param: "category",
  }));
  const sizeOptions: FilterOption[] = [
    ...[...shoeSizes].sort(naturalCompare).map((value) => ({
      label: value,
      value,
      param: "sizeShoe" as const,
      count: shoeSizeCounts[value],
      group: "Footwear",
    })),
    ...[...clothingSizes].sort(naturalCompare).map((value) => ({
      label: formatLabel(value),
      value,
      param: "sizeClothing" as const,
      count: clothingSizeCounts[value],
      group: "Clothing",
    })),
  ];

  const selectedByFacet: Record<string, string[]> = {
    brand: selectedBrands,
    condition: selectedConditions,
    category: selectedCategories,
    size: [...selectedShoeSizes, ...selectedClothingSizes],
  };
  const activeFilterCount =
    selectedBrands.length +
    selectedCategories.length +
    selectedConditions.length +
    selectedShoeSizes.length +
    selectedClothingSizes.length +
    (typeof priceMin === "number" || typeof priceMax === "number" ? 1 : 0);

  const facets = [
    { key: "brand", label: "Brand", options: brandOptions },
    { key: "condition", label: "Condition", options: conditionOptions },
    { key: "price", label: "Price", options: [] },
    { key: "category", label: "Product Type", options: categoryOptions },
    { key: "size", label: "Size", options: sizeOptions },
  ];

  return (
    <div
      ref={containerRef}
      className={`relative z-30 border-b border-zinc-300 bg-[var(--storefront-surface)] px-5 transition-opacity sm:px-8 lg:px-12 ${isPending ? "opacity-60" : ""}`}
    >
      <div className="flex min-h-[72px] flex-wrap items-center gap-x-8 gap-y-2">
        {facets.map((facet) => {
          const selectedCount =
            facet.key === "price"
              ? typeof priceMin === "number" || typeof priceMax === "number"
                ? 1
                : 0
              : (selectedByFacet[facet.key]?.length ?? 0);
          return (
            <div key={facet.key} className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenFacet((current) => (current === facet.key ? null : facet.key))
                }
                className="inline-flex h-10 items-center gap-2 text-[0.78rem] font-medium uppercase tracking-[0.01em] text-zinc-800"
                aria-expanded={openFacet === facet.key}
              >
                <span>
                  {facet.label}
                  {selectedCount > 0 ? ` (${selectedCount})` : ""}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${openFacet === facet.key ? "rotate-180" : ""}`}
                  fill="currentColor"
                />
              </button>

              {openFacet === facet.key && (
                <div className="absolute left-0 top-full z-50 max-h-[19rem] w-[17rem] overflow-y-auto border border-zinc-300 bg-white p-4 shadow-lg">
                  {facet.key === "price" ? (
                    <div className="space-y-1">
                      {PRICE_PRESETS.map((preset) => {
                        const selected =
                          preset.min === priceMin && preset.max === priceMax;
                        return (
                          <label
                            key={preset.label}
                            className="flex cursor-pointer items-center gap-3 py-2 text-sm text-zinc-700"
                          >
                            <input
                              type="radio"
                              name="store-price"
                              checked={selected}
                              onChange={() => selectPrice(preset)}
                              className="h-4 w-4 accent-black"
                            />
                            {preset.label}
                          </label>
                        );
                      })}
                      {(typeof priceMin === "number" || typeof priceMax === "number") && (
                        <button
                          type="button"
                          onClick={() => selectPrice(null)}
                          className="mt-2 text-xs uppercase text-zinc-500 underline underline-offset-4"
                        >
                          Clear price
                        </button>
                      )}
                    </div>
                  ) : facet.options.length > 0 ? (
                    <div>
                      {facet.options.map((option, index) => {
                        const previousGroup = facet.options[index - 1]?.group;
                        const showGroup = option.group && option.group !== previousGroup;
                        return (
                          <div key={`${option.param}-${option.value}`}>
                            {showGroup && (
                              <div className="pb-2 pt-3 text-[0.65rem] font-medium uppercase tracking-[0.08em] text-zinc-400 first:pt-0">
                                {option.group}
                              </div>
                            )}
                            <label className="flex cursor-pointer items-center gap-3 py-2 text-sm text-zinc-700">
                              <input
                                type="checkbox"
                                checked={selectedByFacet[facet.key]?.includes(
                                  option.value,
                                )}
                                onChange={() => toggleOption(option)}
                                className="h-4 w-4 border-zinc-300 accent-black"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {option.label}
                              </span>
                              {typeof option.count === "number" && (
                                <span className="text-xs text-zinc-400">
                                  ({option.count})
                                </span>
                              )}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-4 text-sm text-zinc-500">No options available.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1.5 text-[0.7rem] uppercase text-zinc-500 hover:text-black"
          >
            <X className="h-3.5 w-3.5" />
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
