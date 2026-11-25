import { z } from "zod";
import { env } from "@/config/env";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import type { SpecialtyPublicProduct } from "../Claim/claim-contract";
export { isSpecialtyDiscoveryAllowed, insertDiscoveryItem } from "./discovery-policy";
const rowSchema = z.object({
  product: z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    category: z.string(),
    is_active: z.boolean(),
    archived_at: z.string().nullable(),
    go_live_at: z.string(),
    images: z.array(
      z.object({ url: z.string(), is_primary: z.boolean(), sort_order: z.number() }),
    ),
  }),
  variant: z.object({ stock: z.number() }),
  campaign: z.object({ slug: z.string(), enabled: z.boolean() }),
});
export async function listSpecialtyDiscoveryPool(
  client: AdminSupabaseClient,
): Promise<SpecialtyPublicProduct[]> {
  const { data, error } = await client
    .from("specialty_product_config")
    .select(
      "product:products!inner(id,name,description,category,is_active,archived_at,go_live_at,images:product_images(url,is_primary,sort_order)),variant:product_variants!inner(stock),campaign:specialty_campaigns!inner(slug,enabled)",
    )
    .eq("campaign.slug", env.SPECIALTY_CAMPAIGN_SLUG)
    .eq("campaign.enabled", true)
    .eq("product.category", "specialty")
    .eq("product.is_active", true)
    .is("product.archived_at", null)
    .lte("product.go_live_at", new Date().toISOString())
    .gt("variant.stock", 0)
    .limit(100);
  if (error) throw new Error("Specialty discovery unavailable.");
  return z
    .array(rowSchema)
    .parse(data ?? [])
    .flatMap(({ product, variant, campaign }) => {
      if (
        !campaign.enabled ||
        campaign.slug !== env.SPECIALTY_CAMPAIGN_SLUG ||
        product.category !== "specialty" ||
        !product.is_active ||
        product.archived_at ||
        Date.parse(product.go_live_at) > Date.now() ||
        !Number.isFinite(Date.parse(product.go_live_at)) ||
        variant.stock <= 0
      )
        return [];
      const image = [...product.images].sort(
        (a, b) =>
          Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order,
      )[0];
      return [
        {
          id: product.id,
          name: product.name,
          description: product.description,
          imageUrl: image?.url ?? null,
          claimable: true,
        },
      ];
    });
}
