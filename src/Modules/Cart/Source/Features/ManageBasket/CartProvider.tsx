"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { captureProductAddedToCart } from "@/lib/measurement/client";
import { needsBasketReview } from "../../Contracts/Basket";
import type {
  BasketQuantityUpdate,
  CartContextType,
  CartItem,
} from "../../Contracts/Basket";
import {
  BasketStorage,
  unavailablePurchases,
  unavailableReview,
  type BasketView,
} from "./cart-storage";
import { useBasketIdentity } from "./use-basket-identity";

const cartContext = createContext<CartContextType | null>(null);
const empty: CartItem[] = [];

export function CartProvider({
  children,
}: {
  children: ReactNode;
  userId?: string | null;
}) {
  const identity = useBasketIdentity();
  const { userId: owner, isCurrent } = identity;
  const basket = useMemo(
    () => (owner === undefined ? null : new BasketStorage(owner, isCurrent)),
    [owner, isCurrent],
  );
  const [view, setView] = useState<BasketView & { basket: BasketStorage }>();
  useLayoutEffect(
    () => basket?.connect((next) => setView({ basket, ...next })),
    [basket],
  );

  useEffect(() => {
    function validate() {
      void basket?.validate();
    }
    function onVisible() {
      if (document.visibilityState === "visible") validate();
    }
    window.addEventListener("focus", validate);
    window.addEventListener("openCart", validate);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", validate);
      window.removeEventListener("openCart", validate);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [basket]);
  const items = view?.basket === basket ? view.items : empty;
  const unavailable = useCallback(
    () => Promise.resolve({ status: "unavailable" } as const),
    [],
  );
  const addItem = useCallback(
    async (item: Omit<CartItem, "quantity">) => {
      const added = await (basket?.addItem(item) ?? unavailable());
      if (added.status === "saved")
        captureProductAddedToCart(item.productId, item.variantId);
      return added;
    },
    [basket, unavailable],
  );
  const removeItem = useCallback(
    (productId: string, variantId: string) =>
      basket?.removeItem(productId, variantId) ?? unavailable(),
    [basket, unavailable],
  );
  const updateQuantity = useCallback(
    (productId: string, variantId: string, quantity: BasketQuantityUpdate) =>
      basket?.updateQuantity(productId, variantId, quantity) ?? unavailable(),
    [basket, unavailable],
  );
  const setCartItems = useCallback(
    (nextItems: CartItem[]) => basket?.setItems(nextItems) ?? unavailable(),
    [basket, unavailable],
  );
  const clearCart = useCallback(
    () => basket?.setItems([]) ?? unavailable(),
    [basket, unavailable],
  );
  const storageBlocked = view?.basket === basket && !view.writable;
  return (
    <cartContext.Provider
      value={{
        ...(view?.basket === basket ? view.purchases : unavailablePurchases),
        ...(view?.basket === basket ? view.review : unavailableReview),
        items,
        repairReason: view?.basket === basket ? (view?.repairReason ?? null) : null,
        hasUnreadableItems: Boolean(view?.basket === basket && view?.hasUnreadableItems),
        addItem,
        removeItem,
        updateQuantity,
        setCartItems,
        clearCart,
        itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
        total: items.reduce(
          (sum, i) => sum + (needsBasketReview(i) ? 0 : i.quantity * i.priceCents),
          0,
        ),
        isReady: Boolean(basket && view?.basket === basket && view.writable),
        access: storageBlocked
          ? "unavailable"
          : basket && view?.basket !== basket
            ? "checking"
            : identity.access,
        retryAccess: () => void identity.retry(),
      }}
    >
      {children}
    </cartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(cartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
