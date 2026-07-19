import Image from "next/image";
import Link from "next/link";

import type { ProductWithDetails } from "@/types/domain/product";

interface ProductCardProps {
  product: ProductWithDetails;
  storeHref?: string;
  priority?: boolean;
  view?: "grid" | "list";
}

const formatPrice = (priceCents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);

export function ProductCard({
  product,
  storeHref,
  priority = false,
  view = "grid",
}: ProductCardProps) {
  const primaryImage =
    product.images.find((image) => image.is_primary) ?? product.images[0];
  const prices = product.variants.map((variant) => variant.sale_price_cents);
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;
  const priceDisplay =
    priceMin === priceMax
      ? formatPrice(priceMin)
      : `${formatPrice(priceMin)} - ${formatPrice(priceMax)}`;
  const productHref = storeHref
    ? `/store/${product.id}?from=${encodeURIComponent(storeHref)}`
    : `/store/${product.id}`;

  if (view === "list") {
    return (
      <Link
        href={productHref}
        className="group grid min-h-[14rem] grid-cols-[8rem_1fr] items-center gap-6 px-2 py-8 sm:min-h-[17rem] sm:grid-cols-[18rem_1fr] sm:gap-10 sm:px-6 lg:min-h-[19rem] lg:grid-cols-[19rem_1fr] lg:gap-12 lg:px-10"
        data-testid="product-card"
        data-product-id={product.id}
        prefetch={priority}
      >
        <div className="relative h-36 w-full bg-[var(--storefront-surface)] sm:h-56 lg:h-64">
          {primaryImage && (
            <Image
              src={primaryImage.url}
              alt={product.name}
              fill
              sizes="(min-width: 1024px) 304px, (min-width: 640px) 288px, 128px"
              loading={priority ? "eager" : "lazy"}
              priority={priority}
              className="object-contain transition-transform duration-300 group-hover:scale-[1.03]"
              quality={85}
            />
          )}
        </div>
        <div className="flex flex-col justify-center py-2">
          <h2 className="max-w-3xl text-sm font-normal leading-6 text-zinc-950 sm:text-[1.05rem]">
            {product.name}
          </h2>
          <p className="mt-2 text-sm text-zinc-700 sm:text-base">{product.brand.label}</p>
          <p className="mt-5 text-sm text-zinc-700 sm:text-base">{priceDisplay}</p>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={productHref}
      className="group block min-w-0"
      data-testid="product-card"
      data-product-id={product.id}
      prefetch={priority}
    >
      <article>
        <div className="relative aspect-[1/1.02] bg-[var(--storefront-surface)]">
          {primaryImage && (
            <Image
              src={primaryImage.url}
              alt={product.name}
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              loading={priority ? "eager" : "lazy"}
              priority={priority}
              className="object-contain px-3 transition-transform duration-300 group-hover:scale-[1.03] sm:px-5"
              quality={85}
            />
          )}
        </div>
        <div className="px-2 pb-3 pt-4 text-center">
          <h2 className="mx-auto min-h-10 max-w-[22rem] text-[0.72rem] font-medium uppercase leading-5 text-zinc-900 sm:text-[0.78rem]">
            {product.name}
          </h2>
          <p className="mt-1 text-xs text-zinc-600">{priceDisplay}</p>
        </div>
      </article>
    </Link>
  );
}
