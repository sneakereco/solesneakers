// app/store/[productId]/page.tsx

import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { ProductRepository } from "@/repositories/product-repo";
import { ProductDetail } from "@/components/store/ProductDetail";

const PRODUCT_REVALIDATE_SECONDS = 60;
export const revalidate = 60;

const getCachedProduct = (productId: string) =>
  unstable_cache(
    async () => {
      const supabase = createSupabasePublicClient();
      const repo = new ProductRepository(supabase);
      return repo.getById(productId);
    },
    ["storefront", "product", productId],
    { revalidate: PRODUCT_REVALIDATE_SECONDS, tags: [`product:${productId}`] },
  )();

// Generate metadata for SEO and social sharing
export async function generateMetadata({
  params,
}: {
  params: Promise<{ productId: string }>;
}): Promise<Metadata> {
  const { productId } = await params;

  // Validate UUID format
  const isUuid =
    typeof productId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      productId,
    );

  if (!isUuid) {
    return {
      ...pageMetadata(
        "Product Not Found",
        "This product is unavailable. Browse the latest sneakers and streetwear at Solesneakers.",
      ),
      robots: { index: false, follow: true },
    };
  }

  const product = await getCachedProduct(productId);

  if (!product) {
    return {
      ...pageMetadata(
        "Product Not Found",
        "This product is unavailable. Browse the latest sneakers and streetwear at Solesneakers.",
      ),
      robots: { index: false, follow: true },
    };
  }

  // Get the first variant for pricing
  const firstVariant = product.variants[0];

  // Construct title
  const title = product.name;

  // Construct description
  const conditionText = product.condition === "new" ? "Brand New" : "Pre-Owned";
  const description = product.description
    ? `${conditionText} - ${product.description.slice(0, 150)}${product.description.length > 150 ? "..." : ""}`
    : `${conditionText} ${title}. Premium sneakers and streetwear.`;

  return {
    ...pageMetadata(title, description),
    other: {
      // Additional product-specific meta tags
      "product:price:amount": firstVariant
        ? (firstVariant.sale_price_cents / 100).toString()
        : "",
      "product:price:currency": "USD",
      "product:condition": product.condition,
      "product:availability":
        firstVariant && firstVariant.stock > 0 ? "in stock" : "out of stock",
    },
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const isUuid =
    typeof productId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      productId,
    );
  if (!isUuid) {
    notFound();
  }

  const product = await getCachedProduct(productId);

  if (!product) {
    notFound();
  }

  return <ProductDetail product={product} />;
}
