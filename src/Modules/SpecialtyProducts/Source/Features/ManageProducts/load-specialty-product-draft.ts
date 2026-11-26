import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import type { ProductWithDetails } from "@/types/domain/product";
import type { SpecialtyProductDraft } from "./specialty-product-contract";
export async function loadSpecialtyProductDraft(
  product: ProductWithDetails,
  client: AdminSupabaseClient,
): Promise<SpecialtyProductDraft | undefined> {
  if (product.category !== "specialty") return undefined;
  const { data, error } = await client
    .from("specialty_product_config")
    .select("revision,decision_ordinal,winning_instructions,variant_id")
    .eq("product_id", product.id)
    .single();
  if (error || !data) throw new Error("Specialty details could not be loaded.");
  const variant = product.variants.find((item) => item.id === data.variant_id);
  if (!variant) throw new Error("Specialty inventory could not be loaded.");
  return {
    productId: product.id,
    revision: data.revision,
    hasClaims: data.decision_ordinal > 0,
    remainingQuantity: variant.stock,
    name: product.name,
    description: product.description,
    goLiveAt: product.go_live_at ?? new Date().toISOString(),
    instructions: data.winning_instructions,
    images: product.images.map((image) => ({
      url: image.url,
      sortOrder: image.sort_order,
      isPrimary: image.is_primary,
    })),
  };
}
