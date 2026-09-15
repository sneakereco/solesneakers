// src/components/cart/CartPeekDrawer.tsx
"use client";

import { X, Maximize2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { useCart } from "./CartProvider";

interface CartPeekDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CartPeekDrawer({ isOpen, onClose }: CartPeekDrawerProps) {
  const router = useRouter();
  const { items, total } = useCart();

  if (!isOpen) {
    return null;
  }

  const handleExpand = () => {
    router.push("/cart");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-zinc-800/70 bg-black">
        <div className="p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white sm:text-xl">
              Cart ({items.length})
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
          </div>

          {items.length === 0 ? (
            <p className="py-8 text-center text-gray-400">Your cart is empty</p>
          ) : (
            <>
              <div className="mb-4">
                <div className="mb-4 flex justify-between text-base font-bold text-white sm:text-lg">
                  <span>Total</span>
                  <span>${(total / 100).toFixed(2)}</span>
                </div>

                <button
                  onClick={handleExpand}
                  className="mb-2 flex w-full items-center justify-center gap-2 rounded bg-zinc-800 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 sm:py-3 sm:text-base"
                >
                  <Maximize2 className="h-4 w-4" />
                  View Full Cart
                </button>

                <button className="w-full rounded bg-red-600 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 sm:py-3 sm:text-base">
                  Checkout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
