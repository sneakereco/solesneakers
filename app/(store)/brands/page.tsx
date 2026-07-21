import Link from "next/link";
import { unstable_cache } from "next/cache";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { StorefrontService } from "@/services/storefront-service";

const BRANDS_REVALIDATE_SECONDS = 300;
export const revalidate = 300;

const listBrandLabelsCached = unstable_cache(
  async () => {
    const supabase = createSupabasePublicClient();
    const service = new StorefrontService(supabase);
    const { brands } = await service.listFilters();

    return Array.from(new Set(brands.map((brand) => brand.label).filter(Boolean)));
  },
  ["storefront", "brands"],
  { revalidate: BRANDS_REVALIDATE_SECONDS, tags: ["products:list"] },
);

function buildStoreHref(brand: string) {
  const params = new URLSearchParams({ brand });
  return `/store?${params.toString()}`;
}

function normalizeLetter(label: string) {
  const firstCharacter = label.trim()[0] ?? "";
  return /[a-z]/i.test(firstCharacter) ? firstCharacter.toUpperCase() : "#";
}

export default async function BrandsPage() {
  const labels = (await listBrandLabelsCached()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const groupedBrands = labels.reduce<Map<string, string[]>>((groups, label) => {
    const letter = normalizeLetter(label);
    const brands = groups.get(letter) ?? [];
    brands.push(label);
    groups.set(letter, brands);
    return groups;
  }, new Map());

  const brandGroups = Array.from(groupedBrands.entries()).sort(([a], [b]) => {
    if (a === "#") {
      return 1;
    }
    if (b === "#") {
      return -1;
    }
    return a.localeCompare(b);
  });

  return (
    <main className="min-h-screen border-t border-black/10 bg-[#f4f4f4] text-black">
      <div className="mx-auto w-full max-w-[74rem] px-8 py-12 sm:px-12 sm:py-14 lg:px-16 lg:py-16">
        <h1 className="sr-only">Brands</h1>

        {brandGroups.length > 0 ? (
          <div className="grid grid-cols-1 gap-x-20 gap-y-16 sm:grid-cols-2 lg:grid-cols-3 lg:gap-y-20">
            {brandGroups.map(([letter, brands]) => (
              <section key={letter} className="text-center">
                <h2 className="mb-5 text-[1.35rem] font-semibold leading-none tracking-[0.02em]">
                  {letter}
                </h2>

                <ul className="space-y-3 text-[1.05rem] leading-7 sm:text-[1.1rem]">
                  {brands.map((brand) => (
                    <li key={brand}>
                      <Link
                        href={buildStoreHref(brand)}
                        className="underline-offset-4 transition-opacity duration-200 hover:opacity-55 focus-visible:underline focus-visible:outline-none"
                      >
                        {brand}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="py-20 text-center text-base text-black/60">
            No brands are currently available.
          </p>
        )}
      </div>
    </main>
  );
}
