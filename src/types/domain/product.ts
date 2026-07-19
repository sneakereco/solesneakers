// src/types/views/product.ts
import type { Tables } from "@/types/db/database.types";

export type ProductRow = Tables<"products">;
export type ProductVariantRow = Tables<"product_variants">;
export type ProductImageRow = Tables<"product_images">;
export type TaxonomyReference = { id: string; label: string };

// Column-derived aliases (these will be `string` unless your DB types are enums)
export type Category = ProductRow["category"];
export type Condition = ProductRow["condition"];
export type SizeType = ProductRow["size_type"];
export type ProductWithDetails = ProductRow & {
  brand: TaxonomyReference;
  model: TaxonomyReference | null;
  variants: Array<ProductVariantRow & { size: TaxonomyReference }>;
  images: ProductImageRow[];
};
