"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProductImage } from "@/components/store/ProductImage";
import { FeedbackLink } from "@/components/ui/FeedbackLink";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  FeaturedCardsSkeleton,
  featuredCardClassName,
  clothingFeaturedCardClassName,
} from "@/components/store/StoreSkeletons";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { logError } from "@/lib/utils/log";
import type { StorefrontProduct } from "@/types/domain/product";

import { DiscoveryInsertion } from "@/Modules/SpecialtyProducts/Source/Features/Discovery/DiscoveryInsertion";

type FeaturedProduct = {
  id: string;
  titleDisplay: string;
  primaryImage: string | null;
  minPrice: number;
};

export function FeaturedItems({
  category,
  allowSpecialty = false,
}: { category?: "clothing"; allowSpecialty?: boolean } = {}) {
  const isClothing = category === "clothing";
  const heading = isClothing ? "Shop Clothing" : "Featured Items";
  const headingId = isClothing ? "clothing-items-heading" : "featured-items-heading";
  const productLabel = isClothing ? "clothing products" : "featured products";
  const [featured, setFeatured] = useState<FeaturedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const checkScrollButtons = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    setCanScrollLeft(maxScrollLeft > 1 && container.scrollLeft > 10);
    setCanScrollRight(maxScrollLeft > 1 && container.scrollLeft < maxScrollLeft - 10);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadFeaturedItems = async () => {
      try {
        const endpoint = isClothing
          ? "/api/store/products?category=clothing&sort=newest&limit=12"
          : "/api/featured-items";
        const data = await fetchJsonWithDeadline<{
          products?: StorefrontProduct[];
          featured?: FeaturedProduct[];
        } | null>(endpoint, "Unable to load homepage products", controller.signal);
        if (controller.signal.aborted) return;
        if (isClothing) {
          if (!Array.isArray(data?.products))
            throw new Error("Invalid clothing products");
          const products: StorefrontProduct[] = data.products;
          setFeatured(
            products.flatMap((product) => {
              const prices = product.variants
                .filter(
                  (variant) =>
                    variant.stock > 0 && Number.isFinite(variant.sale_price_cents),
                )
                .map((variant) => variant.sale_price_cents);
              if (prices.length === 0) return [];
              return [
                {
                  id: product.id,
                  titleDisplay: product.name,
                  primaryImage:
                    (
                      product.images.find((image) => image.is_primary) ??
                      product.images[0]
                    )?.url ?? null,
                  minPrice: Math.min(...prices),
                },
              ];
            }),
          );
        } else {
          if (
            !Array.isArray(data?.featured) ||
            data.featured.some(
              (product) =>
                !product ||
                typeof product.id !== "string" ||
                typeof product.titleDisplay !== "string" ||
                !Number.isFinite(product.minPrice),
            )
          )
            throw new Error("Invalid featured products");
          setFeatured(data.featured);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setHasError(true);
        logError(error, { layer: "frontend", event: "load_featured_items_home" });
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void loadFeaturedItems();
    return () => controller.abort();
  }, [isClothing, attempt]);

  useEffect(() => {
    checkScrollButtons();
    const container = scrollRef.current;
    if (!container) return;

    container.addEventListener("scroll", checkScrollButtons, { passive: true });
    window.addEventListener("resize", checkScrollButtons);
    return () => {
      container.removeEventListener("scroll", checkScrollButtons);
      window.removeEventListener("resize", checkScrollButtons);
    };
  }, [featured, checkScrollButtons]);

  const scroll = (direction: "left" | "right") => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({
      left:
        container.scrollLeft +
        (direction === "left" ? -container.clientWidth : container.clientWidth),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };

  if (!isClothing && !isLoading && !hasError && featured.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="bg-white py-14 text-zinc-900 md:py-16"
    >
      <div className="mx-auto max-w-[1800px] px-4 sm:px-6 lg:px-10">
        <h2
          id={headingId}
          className="text-center text-2xl font-normal uppercase tracking-[0.04em] md:text-3xl"
        >
          {heading}
        </h2>

        {isLoading ? (
          <FeaturedCardsSkeleton
            clothing={isClothing}
            label={isClothing ? "Loading clothing" : "Loading featured items"}
          />
        ) : hasError ? (
          <div className="py-10 text-center text-sm text-zinc-500">
            <p role="alert">
              {isClothing
                ? "Clothing is temporarily unavailable."
                : "Featured items are temporarily unavailable."}
            </p>
            <ActionButton
              type="button"
              className="mt-2 min-h-11 px-3 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
              onClick={() => {
                setHasError(false);
                setIsLoading(true);
                setAttempt((value) => value + 1);
              }}
            >
              {isClothing ? "Retry clothing" : "Retry featured items"}
            </ActionButton>
          </div>
        ) : featured.length === 0 ? (
          <p role="status" className="py-10 text-center text-sm text-zinc-500">
            Clothing is coming soon.
          </p>
        ) : (
          <div className="relative mt-10 md:mt-14">
            {canScrollLeft && (
              <ActionButton
                type="button"
                onClick={() => scroll("left")}
                aria-label={`Previous ${productLabel}`}
                className="absolute left-2 top-[38%] z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_2px_14px_rgba(0,0,0,0.14)] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 md:h-14 md:w-14"
              >
                <ChevronLeft className="h-5 w-5 md:h-6 md:w-6" aria-hidden="true" />
              </ActionButton>
            )}

            <div
              ref={scrollRef}
              role="region"
              aria-label={isClothing ? "Clothing products" : "Featured products"}
              className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2 motion-safe:scroll-smooth sm:gap-6 lg:gap-8 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <DiscoveryInsertion
                allowed={allowSpecialty && !isClothing}
                onDiscoveryChange={checkScrollButtons}
                specialtyClassName={`snap-center sm:snap-start ${featuredCardClassName}`}
                items={featured.map((product) => ({
                  id: product.id,
                  node: (
                    <FeedbackLink
                      key={product.id}
                      href={`/store/${product.id}`}
                      className={`group snap-center text-center sm:snap-start ${isClothing ? clothingFeaturedCardClassName : featuredCardClassName}`}
                    >
                      <div className="relative h-48 w-full sm:h-52 md:h-56">
                        {product.primaryImage ? (
                          <ProductImage
                            src={product.primaryImage}
                            alt=""
                            fill
                            sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
                            className="object-contain motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.03]"
                            quality={75}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                            No Image
                          </div>
                        )}
                      </div>
                      <h3 className="mt-5 min-h-10 text-xs font-medium uppercase leading-5 tracking-[0.02em] sm:text-sm">
                        {product.titleDisplay}
                      </h3>
                      <p className="mt-1 text-sm tabular-nums text-zinc-500">
                        ${(product.minPrice / 100).toFixed(2)}
                      </p>
                    </FeedbackLink>
                  ),
                }))}
              />
            </div>

            {canScrollRight && (
              <ActionButton
                type="button"
                onClick={() => scroll("right")}
                aria-label={`Next ${productLabel}`}
                className="absolute right-2 top-[38%] z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_2px_14px_rgba(0,0,0,0.14)] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 md:h-14 md:w-14"
              >
                <ChevronRight className="h-5 w-5 md:h-6 md:w-6" aria-hidden="true" />
              </ActionButton>
            )}
          </div>
        )}
        {isClothing && (
          <div className="mt-8 text-center">
            <FeedbackLink
              href="/store?category=clothing"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-zinc-900 px-8 py-4 text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"
            >
              Shop All Clothing
            </FeedbackLink>
          </div>
        )}
      </div>
    </section>
  );
}
