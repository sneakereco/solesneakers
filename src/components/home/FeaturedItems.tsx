"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { logError } from "@/lib/utils/log";

type FeaturedProduct = {
  id: string;
  name: string;
  brand: { id: string; label: string };
  titleDisplay: string;
  category: string;
  primaryImage: string | null;
  minPrice: number;
  sortOrder: number;
  variants?: Array<{
    size: { id: string; label: string };
    stock: number;
  }>;
};

type FeaturedItemsProps = {
  /**
   * When true: renders only the inner content (no outer <section> wrapper).
   * Intended for hero-overlay use on the home page.
   */
  embedded?: boolean;
};

export function FeaturedItems({ embedded = false }: FeaturedItemsProps) {
  const [featured, setFeatured] = useState<FeaturedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Always render arrows, but disable when you can't scroll.
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const checkScrollButtons = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const maxScrollLeft = container.scrollWidth - container.clientWidth;

    // If content doesn't overflow, both should be false.
    if (maxScrollLeft <= 1) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    setCanScrollLeft(container.scrollLeft > 10);
    setCanScrollRight(container.scrollLeft < maxScrollLeft - 10);
  }, []);

  useEffect(() => {
    const loadFeaturedItems = async () => {
      try {
        const response = await fetch("/api/featured-items");
        const data = await response.json();
        if (response.ok) {
          setFeatured(data.featured || []);
        }
      } catch (error) {
        logError(error, { layer: "frontend", event: "load_featured_items_home" });
      } finally {
        setIsLoading(false);
      }
    };

    void loadFeaturedItems();
  }, []);

  useEffect(() => {
    // Re-check after data renders
    checkScrollButtons();

    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const onScroll = () => checkScrollButtons();
    container.addEventListener("scroll", onScroll, { passive: true });

    const onResize = () => checkScrollButtons();
    window.addEventListener("resize", onResize);

    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [featured, checkScrollButtons]);

  const scroll = (direction: "left" | "right") => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    // page-by-viewport; snap will land on the nearest card boundary
    const scrollAmount = container.clientWidth;

    const target =
      direction === "left"
        ? container.scrollLeft - scrollAmount
        : container.scrollLeft + scrollAmount;

    container.scrollTo({ left: target, behavior: "smooth" });
  };

  // Don't show section if no featured items
  if (!isLoading && featured.length === 0) {
    return null;
  }

  const headerShadow = embedded ? "drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)]" : "";

  const Content = (
    <>
      <div
        className={[
          "flex items-center justify-between",
          embedded ? "mb-3 sm:mb-4 md:mb-5" : "mb-6",
        ].join(" ")}
      >
        <h2
          className={[
            "flex items-center gap-2 text-xl font-bold text-white sm:text-2xl md:text-3xl",
            headerShadow,
          ].join(" ")}
        >
          Featured Items
        </h2>

        <Link
          href="/store"
          className={[
            "whitespace-nowrap text-[10px] font-medium text-gray-200 transition hover:text-white sm:text-xs md:text-sm",
            headerShadow,
          ].join(" ")}
        >
          View All →
        </Link>
      </div>

      {/* Arrows OUTSIDE the scroll area + ALWAYS visible */}
      <div className="flex items-stretch gap-2 sm:gap-3">
        {/* Left Arrow */}
        <button
          type="button"
          onClick={() => canScrollLeft && scroll("left")}
          disabled={!canScrollLeft}
          aria-label="Scroll left"
          className={[
            "shrink-0 self-center rounded-full shadow-lg transition",
            "p-1 sm:p-1.5 md:p-2 lg:p-3",
            "border border-zinc-800/70 bg-zinc-900/80",
            "hover:bg-zinc-800/80",
            !canScrollLeft
              ? "cursor-not-allowed opacity-35 hover:bg-zinc-900/80"
              : "opacity-100",
          ].join(" ")}
        >
          <ChevronLeft className="h-3 w-3 text-white sm:h-4 sm:w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" />
        </button>

        {/* Wrapper to hide partial cards */}
        <div className="flex-1 overflow-hidden">
          {/* Scrollable Container */}
          <div
            ref={scrollRef}
            className={[
              "flex gap-3 overflow-x-auto scroll-smooth sm:gap-4 md:gap-5",
              embedded ? "pb-0" : "pb-2",
              "snap-x snap-mandatory",
              // Hide scrollbar
              "[&::-webkit-scrollbar]:hidden",
            ].join(" ")}
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              WebkitOverflowScrolling: "touch",
              scrollSnapType: "x mandatory",
              scrollPaddingLeft: "0px",
              scrollPaddingRight: "0px",
            }}
          >
            {featured.map((product) => {
              const availableCount =
                product.variants?.filter((v) => v.stock > 0).length ?? 0;

              const sizes = product.variants
                ?.filter((v) => v.stock > 0)
                .map((v) => v.size.label)
                .slice(0, 3);

              return (
                <Link
                  key={product.id}
                  href={`/store/${product.id}`}
                  className="group w-40 flex-shrink-0 snap-start sm:w-48 md:w-52 lg:w-56"
                  style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}
                >
                  <div className="flex h-full flex-col overflow-hidden rounded border border-zinc-800/70 bg-zinc-900 transition hover:border-zinc-600/70">
                    <div className="relative aspect-square bg-zinc-800">
                      {product.primaryImage ? (
                        <Image
                          src={product.primaryImage}
                          alt={product.titleDisplay}
                          fill
                          sizes="(min-width: 1024px) 18vw, (min-width: 640px) 30vw, 45vw"
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                          quality={75}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                          No Image
                        </div>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col p-2 sm:p-3">
                      <div className="mb-1 text-[9px] uppercase tracking-[0.2em] text-gray-400 sm:text-[10px]">
                        {product.brand.label}
                      </div>

                      <h3 className="line-clamp-2 min-h-[1.75rem] text-[11px] font-bold leading-tight text-white sm:min-h-[2rem] sm:text-xs">
                        {product.titleDisplay}
                      </h3>

                      {sizes && sizes.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1 sm:mt-2">
                          {sizes.map((size, idx) => (
                            <span
                              key={idx}
                              className="rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-gray-300 sm:px-1.5 sm:text-[10px]"
                            >
                              {size}
                            </span>
                          ))}

                          {availableCount > 3 && (
                            <span className="px-1 py-0.5 text-[9px] text-gray-400 sm:px-1.5 sm:text-[10px]">
                              +{availableCount - 3}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="mt-auto pt-2 sm:pt-3">
                        <span className="whitespace-nowrap text-sm font-extrabold tabular-nums text-white sm:text-base">
                          From {formatPrice(product.minPrice)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right Arrow */}
        <button
          type="button"
          onClick={() => canScrollRight && scroll("right")}
          disabled={!canScrollRight}
          aria-label="Scroll right"
          className={[
            "shrink-0 self-center rounded-full shadow-lg transition",
            "p-1 sm:p-1.5 md:p-2 lg:p-3",
            "border border-zinc-800/70 bg-zinc-900/80",
            "hover:bg-zinc-800/80",
            !canScrollRight
              ? "cursor-not-allowed opacity-35 hover:bg-zinc-900/80"
              : "opacity-100",
          ].join(" ")}
        >
          <ChevronRight className="h-3 w-3 text-white sm:h-4 sm:w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" />
        </button>
      </div>
    </>
  );

  if (isLoading) {
    if (embedded) {
      return (
        <div className="flex items-center justify-center py-10">
          <div className="text-gray-200 drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)]">
            Loading featured items...
          </div>
        </div>
      );
    }

    return (
      <section className="border-t border-zinc-900 bg-black py-8 md:py-12">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-400">Loading featured items...</div>
          </div>
        </div>
      </section>
    );
  }

  if (embedded) {
    return <div>{Content}</div>;
  }

  return (
    <section className="border-t border-zinc-900 bg-black py-8 md:py-12">
      <div className="mx-auto max-w-7xl px-4">{Content}</div>
    </section>
  );
}
