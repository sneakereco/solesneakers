import type { ProductWithDetails } from "@/types/domain/product";
import { DiscoveryInsertion } from "@/Modules/SpecialtyProducts/Source/Features/Discovery/DiscoveryInsertion";

import { ProductCard } from "./ProductCard";

interface ProductGridProps {
  products: ProductWithDetails[];
  storeHref?: string;
  view?: "grid" | "list";
  allowSpecialty?: boolean;
}

const PRIORITY_CARDS_COUNT = 4;

export function ProductGrid({
  products,
  storeHref,
  view = "grid",
  allowSpecialty = false,
}: ProductGridProps) {
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
      className={
        view === "list"
          ? "w-full"
          : "grid grid-cols-2 gap-x-2 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-4 lg:gap-y-14"
      }
      data-testid="product-grid"
      data-view={view}
    >
      <DiscoveryInsertion
        allowed={allowSpecialty}
        view={view}
        items={products.map((product, index) => ({
          id: product.id,
          node: (
            <ProductCard
              key={product.id}
              product={product}
              storeHref={storeHref}
              priority={index < PRIORITY_CARDS_COUNT}
              view={view}
            />
          ),
        }))}
      />
    </div>
  );
}
