import { NextResponse } from "next/server";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";

export const revalidate = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  const repository = new TagTaxonomyRepository(createSupabasePublicClient());
  const [brands, sizes] = await Promise.all([
    repository.listBrands(),
    repository.listSizes(),
  ]);

  return NextResponse.json(
    {
      brands: brands.map((brand) => ({ id: brand.id, label: brand.canonical_label })),
      sizes: sizes.map((size) => ({
        id: size.id,
        label: size.canonical_label,
        sizeType: size.size_type,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
