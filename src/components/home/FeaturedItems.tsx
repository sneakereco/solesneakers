"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { logError } from "@/lib/utils/log";

type FeaturedProduct = {
  id: string;
  titleDisplay: string;
  primaryImage: string | null;
  minPrice: number;
};

export function FeaturedItems() {
  const [featured, setFeatured] = useState<FeaturedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
    const loadFeaturedItems = async () => {
      try {
        const response = await fetch("/api/featured-items");
        const data = await response.json();
        if (response.ok) setFeatured(data.featured || []);
      } catch (error) {
        logError(error, { layer: "frontend", event: "load_featured_items_home" });
      } finally {
        setIsLoading(false);
      }
    };

    void loadFeaturedItems();
  }, []);

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
      behavior: "smooth",
    });
  };

  if (!isLoading && featured.length === 0) return null;

  return (
    <section className="bg-white py-14 text-zinc-900 md:py-16">
      <div className="mx-auto max-w-[1800px] px-4 sm:px-6 lg:px-10">
        <h2 className="text-center text-2xl font-normal uppercase tracking-[0.04em] md:text-3xl">
          Featured Items
        </h2>

        {isLoading ? (
          <div className="py-24 text-center text-sm text-zinc-500" role="status">
            Loading featured items...
          </div>
        ) : (
          <div className="relative mt-10 md:mt-14">
            {canScrollLeft && (
              <button
                type="button"
                onClick={() => scroll("left")}
                aria-label="Previous featured products"
                className="absolute left-2 top-[38%] z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_2px_14px_rgba(0,0,0,0.14)] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 md:h-14 md:w-14"
              >
                <ChevronLeft className="h-5 w-5 md:h-6 md:w-6" aria-hidden="true" />
              </button>
            )}

            <div
              ref={scrollRef}
              role="region"
              aria-label="Featured products"
              className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-2 sm:gap-6 lg:gap-8 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {featured.map((product) => (
                <Link
                  key={product.id}
                  href={`/store/${product.id}`}
                  className="group w-[78%] shrink-0 snap-start text-center sm:w-[calc((100%-1.5rem)/2)] md:w-[calc((100%-3rem)/3)] lg:w-[calc((100%-6rem)/4)]"
                >
                  <div className="relative h-48 w-full sm:h-52 md:h-56">
                    {product.primaryImage ? (
                      <Image
                        src={product.primaryImage}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 78vw"
                        className="object-contain transition-transform duration-300 group-hover:scale-[1.03]"
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
                </Link>
              ))}
            </div>

            {canScrollRight && (
              <button
                type="button"
                onClick={() => scroll("right")}
                aria-label="Next featured products"
                className="absolute right-2 top-[38%] z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_2px_14px_rgba(0,0,0,0.14)] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 md:h-14 md:w-14"
              >
                <ChevronRight className="h-5 w-5 md:h-6 md:w-6" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
