import type { ProductFilters } from "@/repositories/product-repo";
export function isSpecialtyDiscoveryAllowed(filters: ProductFilters): boolean {
  return (
    !filters.q?.trim() &&
    ![
      filters.category,
      filters.brandIds,
      filters.modelIds,
      filters.sizeIds,
      filters.condition,
    ].some((values) => values?.length) &&
    filters.priceMinCents === undefined &&
    filters.priceMaxCents === undefined
  );
}
export function insertDiscoveryItem<T>(
  items: readonly T[],
  item: T,
  position: number,
): T[] {
  if (!items.length) return [];
  const next = [...items];
  next.splice(Math.max(0, Math.min(next.length, Math.floor(position))), 0, item);
  return next;
}
