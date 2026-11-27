"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import Image from "next/image";
import { FeedbackLink, DocumentFeedbackLink } from "@/components/ui/FeedbackLink";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";

import { useCart } from "@/components/cart/CartProvider";
import { CartFeedback } from "@/components/cart/CartFeedback";
import { CartSkeleton } from "@/components/cart/CartSkeleton";
import { ShippingEstimate } from "@/components/cart/ShippingEstimate";

const formatPrice = (priceCents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);

export default function CartPage() {
  return (
    <>
      <CartFeedback />
      <CartContent />
    </>
  );
}

function CartContent() {
  const {
    items,
    itemCount,
    removeItem,
    updateQuantity,
    total,
    isReady,
    hasCartView,
    validationStatus,
    writePending,
  } = useCart();

  if (!isReady && !hasCartView)
    return validationStatus === "error" ? null : <CartSkeleton />;

  if (items.length === 0) {
    return (
      <div className="flex min-h-[36rem] flex-col items-center justify-center bg-[var(--storefront-surface)] px-5 pb-24 text-center text-black">
        <ShoppingBag className="h-10 w-10" strokeWidth={1.5} />
        <h1 className="mt-5 text-3xl font-normal uppercase tracking-[0.02em]">
          Your cart is empty
        </h1>
        <p className="mt-3 text-sm text-zinc-600">Add an item to begin your order.</p>
        <FeedbackLink
          href="/store"
          className="mt-8 bg-zinc-900 px-10 py-4 text-sm font-medium uppercase text-white transition-colors hover:bg-black"
        >
          Shop Now
        </FeedbackLink>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--storefront-surface)] px-5 pb-24 pt-12 text-black sm:px-8 lg:px-12">
      <h1 className="text-center text-3xl font-normal uppercase tracking-[0.02em] sm:text-[2rem]">
        Shopping Cart <span className="text-zinc-500">({itemCount})</span>
      </h1>

      <div className="mx-auto mt-14 grid max-w-[90rem] grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-14">
        <section aria-label="Cart items" className="border-t border-zinc-300">
          {items.map((item) => {
            const canIncrease =
              typeof item.maxStock === "number" ? item.quantity < item.maxStock : true;

            return (
              <article
                key={`${item.productId}-${item.variantId}`}
                className="grid grid-cols-[7rem_minmax(0,1fr)] gap-5 border-b border-zinc-300 py-7 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-8"
              >
                <FeedbackLink
                  href={`/store/${item.productId}`}
                  className="relative h-32 w-28 bg-[var(--storefront-surface)] sm:h-44 sm:w-40"
                >
                  <Image
                    src={item.imageUrl}
                    alt={item.titleDisplay}
                    fill
                    sizes="(min-width: 640px) 160px, 112px"
                    className="object-contain p-2 mix-blend-multiply"
                  />
                </FeedbackLink>

                <div className="flex min-w-0 flex-col">
                  <div className="flex items-start justify-between gap-4">
                    <FeedbackLink href={`/store/${item.productId}`} className="min-w-0">
                      <h2 className="text-sm font-medium uppercase leading-5 sm:text-base sm:leading-6">
                        {item.titleDisplay}
                      </h2>
                      {item.brand && (
                        <p className="mt-1 text-xs uppercase text-zinc-500 sm:text-sm">
                          {item.brand}
                        </p>
                      )}
                    </FeedbackLink>
                    <p className="shrink-0 text-sm font-medium sm:text-base">
                      {formatPrice(item.priceCents * item.quantity)}
                    </p>
                  </div>

                  <p className="mt-4 text-xs text-zinc-500 sm:text-sm">
                    Size: {item.sizeLabel === "N/A" ? "One size" : item.sizeLabel}
                  </p>

                  <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-5">
                    <div className="inline-grid grid-cols-3 border border-zinc-300">
                      <ActionButton
                        type="button"
                        onClick={() =>
                          void updateQuantity(
                            item.productId,
                            item.variantId,
                            item.quantity - 1,
                          )
                        }
                        className="flex h-10 w-10 cursor-pointer items-center justify-center hover:bg-white"
                        disabled={!isReady || writePending}
                        aria-label={`Decrease quantity for ${item.titleDisplay}`}
                      >
                        <Minus className="h-4 w-4" />
                      </ActionButton>
                      <span className="flex h-10 min-w-10 items-center justify-center border-x border-zinc-300 text-sm">
                        {item.quantity}
                      </span>
                      <ActionButton
                        type="button"
                        onClick={() =>
                          void updateQuantity(
                            item.productId,
                            item.variantId,
                            item.quantity + 1,
                          )
                        }
                        disabled={!isReady || writePending || !canIncrease}
                        className="flex h-10 w-10 cursor-pointer items-center justify-center hover:bg-white disabled:cursor-not-allowed disabled:text-zinc-300"
                        aria-label={`Increase quantity for ${item.titleDisplay}`}
                      >
                        <Plus className="h-4 w-4" />
                      </ActionButton>
                    </div>

                    <ActionButton
                      type="button"
                      disabled={!isReady || writePending}
                      onClick={() => void removeItem(item.productId, item.variantId)}
                      className="cursor-pointer p-2 text-zinc-500 transition-colors hover:text-black"
                      aria-label={`Remove ${item.titleDisplay} from cart`}
                    >
                      <Trash2 className="h-5 w-5" strokeWidth={1.6} />
                    </ActionButton>
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="border border-zinc-300 bg-white p-6 lg:sticky lg:top-36">
          <ShippingEstimate className="-mx-6 -mt-6 mb-6 border-b border-zinc-200" />
          <h2 className="text-lg font-medium uppercase tracking-[0.02em]">
            Order Summary
          </h2>
          <div className="mt-7 flex items-center justify-between border-b border-zinc-200 pb-5 text-base">
            <span>Subtotal</span>
            <span className="font-medium">{formatPrice(total)}</span>
          </div>
          <p className="mt-4 text-xs leading-5 text-zinc-500">
            Shipping and taxes are calculated at checkout.
          </p>
          <DocumentFeedbackLink
            href={!isReady || writePending ? undefined : "/checkout"}
            aria-disabled={!isReady || writePending || undefined}
            data-checkout-link
            className="mt-6 block w-full bg-zinc-950 px-6 py-4 text-center text-sm font-medium uppercase text-white transition-colors hover:bg-black"
          >
            Checkout
          </DocumentFeedbackLink>
          <FeedbackLink
            href="/store"
            className="mt-5 block text-center text-sm underline underline-offset-4"
          >
            Continue shopping
          </FeedbackLink>
        </aside>
      </div>
    </div>
  );
}
