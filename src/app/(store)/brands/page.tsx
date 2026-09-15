import Link from "next/link";
import { unstable_cache } from "next/cache";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";

const BRANDS_REVALIDATE_SECONDS = 300;
export const revalidate = 300;

type BrandOption = {
  id: string;
  label: string;
};

const listBrandsCached = unstable_cache(
  async () => {
    const supabase = createSupabasePublicClient();
    const repository = new TagTaxonomyRepository(supabase);
    const brands = await repository.listBrands();

    const seen = new Set<string>();
    return brands.reduce<BrandOption[]>((entries, brand) => {
      if (!brand.id || !brand.canonical_label || seen.has(brand.id)) {
        return entries;
      }
      seen.add(brand.id);
      entries.push({ id: brand.id, label: brand.canonical_label });
      return entries;
    }, []);
  },
  ["storefront", "brands"],
  { revalidate: BRANDS_REVALIDATE_SECONDS, tags: ["products:list"] },
);

function buildBrandHref(brandId: string) {
  const params = new URLSearchParams();
  params.append("brandIds", brandId);
  return `/store?${params.toString()}`;
}

function normalizeLetter(label: string) {
  const firstCharacter = label.trim()[0] ?? "";
  return /[a-z]/i.test(firstCharacter) ? firstCharacter.toUpperCase() : "#";
}

export default async function BrandsPage() {
  const brands = (await listBrandsCached()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );

  const groupedBrands = brands.reduce<Map<string, BrandOption[]>>((groups, brand) => {
    const letter = normalizeLetter(brand.label);
    const entries = groups.get(letter) ?? [];
    entries.push(brand);
    groups.set(letter, entries);
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
    <main className="min-h-screen bg-[#f4f4f4] text-black">
      <div className="mx-auto w-full px-8 pb-20 pt-8 sm:px-12 sm:pt-9 lg:px-16">
        <h1 className="sr-only">Brands</h1>

        {brandGroups.length > 0 ? (
          <div className="mx-auto grid max-w-[64rem] grid-cols-1 gap-x-16 gap-y-16 sm:grid-cols-2 lg:grid-cols-3 lg:gap-y-[3.75rem]">
            {brandGroups.map(([letter, brandsForLetter]) => (
              <section key={letter} className="text-center">
                <h2 className="mb-6 text-[1.3rem] font-semibold leading-none tracking-[0.02em]">
                  {letter}
                </h2>

                <ul className="space-y-2 text-[1.05rem] leading-8 sm:text-[1.1rem]">
                  {brandsForLetter.map((brand) => (
                    <li key={brand.id}>
                      <Link
                        href={buildBrandHref(brand.id)}
                        className="underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {brand.label}
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
