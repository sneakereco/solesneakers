"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useId } from "react";
import Image from "next/image";
import { FeedbackLink } from "@/components/ui/FeedbackLink";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";

import { ModalPortal, useOverlayTransition } from "@/components/ui/ModalPortal";

import { useCart } from "./CartProvider";
import { CartFeedback } from "./CartFeedback";
import { CartSkeleton } from "./CartSkeleton";
import { ShippingEstimate } from "./ShippingEstimate";

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  invoker?: HTMLElement | null;
}

const formatPrice = (priceCents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);

export function CartDrawer({ isOpen, onClose, invoker }: CartDrawerProps) {
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
  const titleId = useId();
  const { present, visible } = useOverlayTransition(isOpen, 240);

  return (
    <ModalPortal
      open={present}
      invoker={invoker}
      onClose={() => {
        if (isOpen) onClose();
      }}
      labelledBy={titleId}
      placement="right"
      zIndexClassName="z-[80]"
      contentClassName="contents"
      backdropClassName={`bg-black/40 transition-opacity duration-[240ms] ease-out motion-reduce:transition-none ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <aside
        inert={!isOpen}
        className={`relative flex h-full w-full flex-col bg-white text-black shadow-2xl transition-transform duration-[240ms] ease-out motion-reduce:transition-none sm:max-w-[34rem] ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="relative flex min-h-16 shrink-0 items-center justify-center border-b border-zinc-200 px-14">
          <h2 id={titleId} className="text-xl font-normal">
            My cart{" "}
            {(isReady || hasCartView) && (
              <>
                <span aria-hidden="true">&#8226;</span> {itemCount}
              </>
            )}
          </h2>
          <ActionButton
            type="button"
            onClick={onClose}
            className="absolute right-5 top-1/2 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center text-black transition-colors hover:text-zinc-500"
            aria-label="Close cart"
          >
            <X className="h-6 w-6" strokeWidth={1.7} />
          </ActionButton>
        </header>

        <CartFeedback />
        {!isReady && !hasCartView ? (
          validationStatus === "error" ? null : (
            <CartSkeleton drawer />
          )
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
            <ShoppingBag className="h-8 w-8" strokeWidth={1.7} />
            <p className="mt-4 text-base">Your cart is empty</p>
            <FeedbackLink
              href="/store"
              onNavigate={onClose}
              className="mt-7 bg-zinc-900 px-8 py-3 text-sm font-medium uppercase text-white transition-colors hover:bg-black"
            >
              Shop Now
            </FeedbackLink>
          </div>
        ) : (
          <>
            <ShippingEstimate className="shrink-0 border-b border-zinc-200" />
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6">
              {items.map((item) => {
                const canIncrease =
                  typeof item.maxStock === "number"
                    ? item.quantity < item.maxStock
                    : true;

                return (
                  <article
                    key={`${item.productId}-${item.variantId}`}
                    className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 border-b border-zinc-200 py-6"
                  >
                    <FeedbackLink
                      href={`/store/${item.productId}`}
                      onNavigate={onClose}
                      className="relative h-28 w-24 bg-[var(--storefront-surface)]"
                    >
                      <Image
                        src={item.imageUrl}
                        alt={item.titleDisplay}
                        fill
                        sizes="96px"
                        className="object-contain p-1 mix-blend-multiply"
                      />
                    </FeedbackLink>

                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <FeedbackLink
                          href={`/store/${item.productId}`}
                          onNavigate={onClose}
                          className="min-w-0"
                        >
                          <h3 className="text-sm font-medium uppercase leading-5 text-zinc-950">
                            {item.titleDisplay}
                          </h3>
                          {item.brand && (
                            <p className="mt-1 text-xs uppercase text-zinc-500">
                              {item.brand}
                            </p>
                          )}
                        </FeedbackLink>
                        <p className="shrink-0 text-sm font-medium">
                          {formatPrice(item.priceCents * item.quantity)}
                        </p>
                      </div>

                      <p className="mt-3 text-xs text-zinc-500">
                        Size: {item.sizeLabel === "N/A" ? "One size" : item.sizeLabel}
                      </p>

                      <div className="mt-4 flex items-center justify-between gap-4">
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
                            className="flex h-9 w-9 cursor-pointer items-center justify-center transition-colors hover:bg-zinc-100"
                            disabled={!isReady || writePending}
                            aria-label={`Decrease quantity for ${item.titleDisplay}`}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </ActionButton>
                          <span className="flex h-9 min-w-9 items-center justify-center border-x border-zinc-300 text-sm">
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
                            className="flex h-9 w-9 cursor-pointer items-center justify-center transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300"
                            aria-label={`Increase quantity for ${item.titleDisplay}`}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </ActionButton>
                        </div>

                        <ActionButton
                          type="button"
                          disabled={!isReady || writePending}
                          onClick={() => void removeItem(item.productId, item.variantId)}
                          className="cursor-pointer p-2 text-zinc-500 transition-colors hover:text-black"
                          aria-label={`Remove ${item.titleDisplay} from cart`}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                        </ActionButton>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <footer className="shrink-0 border-t border-zinc-200 bg-white px-5 pb-6 pt-5 sm:px-6">
              <div className="flex items-center justify-between text-base font-medium">
                <span>Subtotal</span>
                <span>{formatPrice(total)}</span>
              </div>
              <a
                href={!isReady || writePending ? undefined : "/checkout"}
                aria-disabled={!isReady || writePending || undefined}
                data-checkout-link
                className="mt-5 block w-full cursor-pointer bg-zinc-900 px-6 py-4 text-center text-sm font-medium uppercase text-white transition-colors hover:bg-black"
              >
                Checkout <span aria-hidden="true">&#8226;</span> {formatPrice(total)}
              </a>
              <FeedbackLink
                href="/store"
                onNavigate={onClose}
                className="mt-5 block text-center text-sm underline underline-offset-4"
              >
                Continue shopping
              </FeedbackLink>
              <FeedbackLink
                href="/cart"
                onNavigate={onClose}
                className="mt-3 block text-center text-xs text-zinc-500 underline underline-offset-4"
              >
                View full cart
              </FeedbackLink>
            </footer>
          </>
        )}
      </aside>
    </ModalPortal>
  );
}
