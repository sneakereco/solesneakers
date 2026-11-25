import type { ProductWithDetails } from "@/types/domain/product";

import { ProductCard } from "./ProductCard";
import { productGridClassName } from "./StoreSkeletons";

interface ProductGridProps {
  products: ProductWithDetails[];
  storeHref?: string;
  view?: "grid" | "list";
}

const PRIORITY_CARDS_COUNT = 4;

export function ProductGrid({ products, storeHref, view = "grid" }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="py-24 text-center">
        <h2 className="text-xl font-medium uppercase text-zinc-800">No products found</h2>
        <p className="mt-3 text-sm text-zinc-500">
          Try removing a filter or searching for something else.
        </p>
      </div>
    );
  }

  return (
    <div
      className={view === "list" ? "w-full" : productGridClassName}
      data-testid="product-grid"
      data-view={view}
    >
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          storeHref={storeHref}
          priority={index < PRIORITY_CARDS_COUNT}
          view={view}
        />
      ))}
    </div>
  );
}
