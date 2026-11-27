"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { captureProductAddedToCart } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/triggers";
import { useViewGrant } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/view-grant";
import { needsBasketReview } from "../../Contracts/Basket";
import type {
  BasketMutationResult,
  BasketQuantityUpdate,
  CartContextType,
  CartItem,
} from "../../Contracts/Basket";
import {
  BasketStorage,
  unavailablePurchases,
  unavailableReview,
  type BasketView,
  type OwnerValidationScope,
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
  const grant = useViewGrant();
  const currentGrant = useRef(grant);
  useLayoutEffect(() => {
    currentGrant.current = grant;
    return () => {
      currentGrant.current = null;
    };
  }, [grant]);
  const [validation] = useState<OwnerValidationScope>(() => ({}));
  useLayoutEffect(
    () => () => {
      validation.current = undefined;
    },
    [validation],
  );
  const [reopen, setReopen] = useState<{ observed: () => boolean }>();
  const basket = useMemo(
    () =>
      owner === undefined
        ? null
        : new BasketStorage(owner, isCurrent, validation, reopen?.observed !== isCurrent),
    [owner, isCurrent, validation, reopen],
  );
  const [feedback, setFeedback] = useState<{
    basket: BasketStorage;
    pending: number;
    error: string | null;
  }>();
  const [validationState, setValidationState] = useState<{
    basket: BasketStorage;
    status: "idle" | "loading" | "error";
  }>();
  const observeValidation = useCallback(
    (source: BasketStorage, status: "idle" | "loading" | "error") =>
      setValidationState({ basket: source, status }),
    [],
  );
  const [view, setView] = useState<BasketView & { basket: BasketStorage }>();
  useLayoutEffect(
    () =>
      basket?.connect(
        (next) => setView({ basket, ...next }),
        (status) => observeValidation(basket, status),
      ),
    [basket, observeValidation],
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
  const mutate = useCallback(
    async (operation: (current: BasketStorage) => Promise<BasketMutationResult>) => {
      if (!basket || !isCurrent()) return unavailable();
      setFeedback((last) => ({
        basket,
        pending: (last?.basket === basket ? last.pending : 0) + 1,
        error: null,
      }));
      let error: string | null = "Could not save your cart. Please try again.";
      try {
        const result = await operation(basket);
        if (result.status === "saved") error = null;
        if (result.status === "stale")
          error = "Your cart changed. Review it and try again.";
        return result;
      } finally {
        if (isCurrent())
          setFeedback((last) =>
            last?.basket === basket
              ? { ...last, pending: last.pending - 1, error }
              : last,
          );
      }
    },
    [basket, isCurrent, unavailable],
  );
  const addItem = useCallback(
    async (item: Omit<CartItem, "quantity">) => {
      const startedWith = currentGrant.current;
      const added = await mutate((current) => current.addItem(item));
      if (
        added.status === "saved" &&
        isCurrent() &&
        startedWith &&
        currentGrant.current === startedWith
      )
        captureProductAddedToCart(item.productId, item.variantId);
      return added;
    },
    [mutate, isCurrent],
  );
  const removeItem = useCallback(
    (productId: string, variantId: string) =>
      mutate((current) => current.removeItem(productId, variantId)),
    [mutate],
  );
  const updateQuantity = useCallback(
    (productId: string, variantId: string, quantity: BasketQuantityUpdate) =>
      mutate((current) => current.updateQuantity(productId, variantId, quantity, items)),
    [mutate, items],
  );
  const setCartItems = useCallback(
    (nextItems: CartItem[]) => mutate((current) => current.setItems(nextItems)),
    [mutate],
  );
  const clearCart = useCallback(
    () => mutate((current) => current.setItems([])),
    [mutate],
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
        hasCartView: Boolean(basket && view?.basket === basket),
        writePending: !!feedback && feedback.basket === basket && feedback.pending > 0,
        writeError: feedback?.basket === basket ? feedback.error : null,
        validationStatus:
          storageBlocked ||
          identity.access === "unavailable" ||
          identity.access === "denied"
            ? "error"
            : identity.access === "checking"
              ? "loading"
              : validationState?.basket === basket
                ? validationState.status
                : "idle",
        retrySavedAccess: () => {
          if (isCurrent() && storageBlocked) setReopen({ observed: isCurrent });
        },
        retryValidation: () => {
          if (storageBlocked || identity.access !== "ready") void identity.retry();
          else void basket?.validate(true);
        },
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
