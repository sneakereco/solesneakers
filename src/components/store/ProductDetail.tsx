"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { useCart } from "@/components/cart/CartProvider";
import { Toast } from "@/components/ui/Toast";
import type { ProductWithDetails } from "@/types/domain/product";

interface ProductDetailProps {
  product: ProductWithDetails;
}

const formatPrice = (priceCents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);

const getConditionLabel = (condition: string) => {
  if (condition === "used") {
    return "Pre-owned";
  }

  return condition.charAt(0).toUpperCase() + condition.slice(1);
};

export function ProductDetail({ product }: ProductDetailProps) {
  const { addItem, items } = useCart();
  const initialVariant =
    product.variants.find((variant) => variant.stock > 0) ?? product.variants[0];
  const initialImageIndex = Math.max(
    0,
    product.images.findIndex((image) => image.is_primary),
  );

  const [selectedVariantId, setSelectedVariantId] = useState(initialVariant?.id ?? "");
  const selectedSizeIdRef = useRef<string | null>(initialVariant?.size.id ?? null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(initialImageIndex);
  const [showShipping, setShowShipping] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  } | null>(null);

  const selectedVariant =
    product.variants.find((variant) => variant.id === selectedVariantId) ??
    initialVariant;
  const selectedImage =
    product.images[selectedImageIndex] ?? product.images[initialImageIndex];
  const primaryImage = product.images[initialImageIndex];
  const inCartItem = selectedVariant
    ? items.find(
        (item) => item.productId === product.id && item.variantId === selectedVariant.id,
      )
    : undefined;
  const inCartQuantity = inCartItem?.quantity ?? 0;
  const canAddMore = selectedVariant ? selectedVariant.stock > inCartQuantity : false;
  const conditionLabel = getConditionLabel(product.condition);

  useEffect(() => {
    const current = product.variants.find((variant) => variant.id === selectedVariantId);
    if (current) {
      selectedSizeIdRef.current = current.size.id;
      return;
    }

    const fallbackSizeId = selectedSizeIdRef.current;
    const variantWithSameSize = fallbackSizeId
      ? product.variants.find((variant) => variant.size.id === fallbackSizeId)
      : undefined;
    const nextVariant =
      variantWithSameSize ??
      product.variants.find((variant) => variant.stock > 0) ??
      product.variants[0];

    if (nextVariant && nextVariant.id !== selectedVariantId) {
      selectedSizeIdRef.current = nextVariant.size.id;
      setSelectedVariantId(nextVariant.id);
    }
  }, [product.variants, selectedVariantId]);

  const handleAddToCart = () => {
    if (!selectedVariant) {
      return;
    }

    if (!canAddMore) {
      setToast({
        message: "Only limited stock is available for this size.",
        tone: "info",
      });
      return;
    }

    addItem({
      productId: product.id,
      variantId: selectedVariant.id,
      sizeLabel: selectedVariant.size.label,
      brand: product.brand.label,
      name: product.name,
      titleDisplay: product.name,
      priceCents: selectedVariant.sale_price_cents,
      imageUrl: primaryImage?.url || "/placeholder.png",
      maxStock: selectedVariant.stock,
    });

    setToast({ message: "Added to cart.", tone: "success" });
  };

  return (
    <section
      data-product-detail
      className="min-h-screen bg-[var(--storefront-surface)] text-black"
    >
      <div className="mx-auto grid max-w-[120rem] grid-cols-1 items-start lg:min-h-[42rem] lg:grid-cols-[minmax(0,1.75fr)_minmax(24rem,0.9fr)]">
        <div className="flex min-w-0 flex-col gap-4 px-5 pb-8 pt-5 sm:px-8 lg:flex-row lg:gap-6 lg:px-5 lg:py-5 xl:gap-8">
          {product.images.length > 1 && (
            <div
              className="order-2 flex w-full gap-3 overflow-x-auto pb-1 lg:order-1 lg:w-[4.5rem] lg:flex-col lg:overflow-visible lg:pb-0"
              aria-label="Product images"
            >
              {product.images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setSelectedImageIndex(index)}
                  aria-label={`View product image ${index + 1}`}
                  aria-pressed={selectedImageIndex === index}
                  className={`relative h-16 w-16 shrink-0 overflow-hidden bg-[var(--storefront-surface)] transition-colors lg:h-[4.5rem] lg:w-[4.5rem] ${
                    selectedImageIndex === index
                      ? "border border-black"
                      : "border border-transparent hover:border-zinc-400"
                  }`}
                >
                  <Image
                    src={image.url}
                    alt={`${product.name}, view ${index + 1}`}
                    fill
                    sizes="72px"
                    loading="eager"
                    priority={index < 4}
                    className="object-contain p-1 mix-blend-multiply"
                    quality={75}
                  />
                </button>
              ))}
            </div>
          )}

          <div className="relative order-1 aspect-square min-w-0 flex-1 lg:order-2 lg:aspect-auto lg:min-h-[39rem]">
            <Image
              src={selectedImage?.url || "/placeholder.png"}
              alt={product.name}
              fill
              sizes="(min-width: 1280px) 58vw, (min-width: 1024px) 55vw, 100vw"
              priority
              className="object-contain p-3 mix-blend-multiply sm:p-6 lg:p-8"
              quality={90}
            />
          </div>
        </div>

        <div className="border-t border-zinc-200 px-6 py-10 sm:px-10 lg:border-l lg:border-t-0 lg:px-8 lg:py-8 xl:px-10">
          <p className="text-[0.78rem] uppercase tracking-[0.02em] text-zinc-500">
            {product.brand.label}
          </p>
          <h1 className="mt-3 max-w-[34rem] text-[1.6rem] font-normal uppercase leading-[1.35] tracking-[0.01em] text-zinc-950 sm:text-[1.75rem]">
            {product.name}
          </h1>

          <p className="mt-4 text-[1.35rem] font-normal text-zinc-950">
            {formatPrice(selectedVariant?.sale_price_cents ?? 0)}
          </p>

          <fieldset className="mt-10">
            <legend className="text-base text-zinc-900">Size:</legend>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {product.variants.map((variant) => {
                const isSelected = variant.id === selectedVariant?.id;
                const isUnavailable = variant.stock <= 0;
                const sizeLabel =
                  variant.size.label === "N/A" ? "One size" : variant.size.label;

                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={isUnavailable}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedVariantId(variant.id)}
                    className={`min-h-[3.25rem] min-w-[3.25rem] border px-3 py-2 text-sm transition-colors ${
                      isSelected
                        ? "border-black shadow-[inset_0_0_0_1px_#000]"
                        : "border-zinc-300 hover:border-zinc-700"
                    } ${
                      isUnavailable
                        ? "cursor-not-allowed text-zinc-400 line-through opacity-60"
                        : "cursor-pointer text-zinc-900"
                    }`}
                  >
                    {sizeLabel}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-6">
            <p className="text-base text-zinc-900">Condition:</p>
            <div className="mt-3 inline-flex min-h-[3.25rem] items-center border border-black px-4 py-2 text-sm text-zinc-900">
              {conditionLabel}
            </div>
          </div>

          <button
            type="button"
            onClick={handleAddToCart}
            disabled={!selectedVariant || selectedVariant.stock <= 0 || !canAddMore}
            className="mt-7 w-full cursor-pointer bg-zinc-900 px-6 py-4 text-sm font-medium uppercase text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            {!selectedVariant || selectedVariant.stock <= 0
              ? "Out of Stock"
              : inCartQuantity > 0
                ? canAddMore
                  ? `Add Another (${inCartQuantity} in cart)`
                  : "In Cart (Max)"
                : "Add to Cart"}
          </button>

          {product.description && (
            <div className="mt-8 border-t border-zinc-300 pt-6">
              <h2 className="text-sm font-medium uppercase tracking-[0.02em]">
                Description
              </h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-600">
                {product.description}
              </p>
            </div>
          )}

          <div className="mt-8 border-t border-zinc-300 pt-5">
            <button
              type="button"
              onClick={() => setShowShipping((current) => !current)}
              aria-expanded={showShipping}
              className="flex w-full cursor-pointer items-center justify-between text-left text-sm font-medium uppercase tracking-[0.02em]"
            >
              Shipping &amp; Returns
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 transition-transform ${showShipping ? "rotate-180" : ""}`}
              />
            </button>

            {showShipping && (
              <div className="mt-4 space-y-3 text-sm leading-6 text-zinc-600">
                <p>
                  Orders placed before 3:00 PM ET ship the same day. Orders placed at or
                  after 3:00 PM ET ship the following day. Shipping options and rates are
                  shown at checkout.
                </p>
                <p>Returns are handled according to our published store policies.</p>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <Link href="/shipping" className="underline underline-offset-4">
                    Shipping Policy
                  </Link>
                  <Link href="/refunds" className="underline underline-offset-4">
                    Returns and Refunds Policy
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Toast
        open={Boolean(toast)}
        message={toast?.message ?? ""}
        tone={toast?.tone ?? "info"}
        onClose={() => setToast(null)}
      />
    </section>
  );
}
