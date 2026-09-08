"use client";

import { ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { useCart } from "@/components/cart/CartProvider";

export function CheckoutHeader() {
  const { itemCount } = useCart();
  const cartLabel = `Go to cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}`;

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto grid h-24 w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-5 sm:h-28 sm:px-8 lg:px-12">
        <Link href="/" aria-label="Sole Sneakers home" className="col-start-2">
          <Image
            src="/images/logo.png"
            alt="Sole Sneakers"
            width={124}
            height={124}
            sizes="96px"
            className="h-20 w-20 object-contain sm:h-24 sm:w-24"
            priority
            unoptimized
          />
        </Link>
        <Link
          href="/cart"
          aria-label={cartLabel}
          className="relative col-start-3 justify-self-end rounded p-2 text-sky-600 transition-colors hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
        >
          <ShoppingBag className="h-6 w-6" aria-hidden="true" />
          {itemCount > 0 ? (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-zinc-950 px-1 text-xs font-semibold text-white">
              {itemCount}
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  );
}
