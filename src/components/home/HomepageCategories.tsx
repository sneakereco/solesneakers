"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import {
  getHomepageCategories,
  type HomepageBrand,
} from "@/components/home/homepage-categories";
import { logError } from "@/lib/utils/log";

export function HomepageCategories() {
  const [brands, setBrands] = useState<HomepageBrand[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    const loadBrands = async () => {
      try {
        const response = await fetch("/api/store/taxonomy", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load collection brands");
        const data = await response.json();
        if (
          !Array.isArray(data.brands) ||
          !data.brands.every(
            (brand: HomepageBrand) =>
              brand && typeof brand.id === "string" && typeof brand.label === "string",
          )
        ) {
          throw new Error("Invalid collection brands");
        }
        if (!controller.signal.aborted) {
          setBrands(data.brands);
          setStatus("ready");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        logError(error, { layer: "frontend", event: "load_homepage_category_brands" });
        setStatus("error");
      }
    };

    void loadBrands();
    return () => controller.abort();
  }, [attempt]);

  const categories = getHomepageCategories(brands);
  const designerUnavailable = status !== "loading" && !categories[2].href;

  return (
    <section
      aria-labelledby="homepage-categories-heading"
      className="bg-[var(--storefront-surface)] py-10 text-zinc-900 sm:py-14 lg:py-[60px]"
    >
      <div className="mx-auto max-w-[1440px] px-[18px] sm:px-6 lg:px-8">
        <div className="mb-8 text-center">
          <h2
            id="homepage-categories-heading"
            className="text-xl font-normal uppercase tracking-[0.04em] sm:text-2xl lg:text-[28px]"
          >
            Shop by Category
          </h2>
          <p className="mt-3 text-xs text-zinc-500 sm:text-[13px]">
            Find your next pair. And everything to go with it.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((category) => {
            const content = (
              <>
                <div
                  className={`relative overflow-hidden bg-white ${
                    category.featured
                      ? "aspect-[4/3] lg:aspect-video"
                      : "aspect-[4/3] sm:aspect-square"
                  }`}
                >
                  <Image
                    src={`/images/homepage_categories/${category.image}`}
                    alt=""
                    fill
                    sizes={
                      category.featured
                        ? "(min-width: 1440px) 676px, (min-width: 640px) 50vw, 100vw"
                        : "(min-width: 1440px) 326px, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                    }
                    className="object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.035]"
                    style={{ objectPosition: category.objectPosition }}
                  />
                </div>
                <div className="flex min-h-[62px] items-center justify-between gap-3 border-b border-zinc-300 py-3">
                  <h3 className="text-[13px] font-medium uppercase leading-5 tracking-[0.035em] lg:text-sm">
                    {category.label}
                  </h3>
                  {category.href && (
                    <ArrowUpRight className="h-5 w-5 shrink-0" aria-hidden="true" />
                  )}
                </div>
              </>
            );
            const className = category.featured ? "lg:col-span-2" : "";

            return category.href ? (
              <Link
                key={category.label}
                href={category.href}
                className={`group block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900 ${className}`}
              >
                {content}
              </Link>
            ) : (
              <div key={category.label} aria-disabled="true" className={className}>
                {content}
              </div>
            );
          })}
        </div>

        {status === "loading" && (
          <p role="status" className="mt-6 text-center text-xs text-zinc-500">
            Loading designer collections...
          </p>
        )}
        {designerUnavailable && (
          <div className="mt-6 text-center text-sm text-zinc-600">
            <p role="status">Designer collections are temporarily unavailable.</p>
            <button
              type="button"
              onClick={() => {
                setStatus("loading");
                setAttempt((value) => value + 1);
              }}
              className="mt-1 min-h-11 px-3 underline underline-offset-4 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            >
              Retry designer collections
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
