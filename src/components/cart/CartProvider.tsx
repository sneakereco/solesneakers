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
import { CartService, type CartView } from "@/services/cart-service";
import type { CartItem } from "@/types/domain/cart";
import type { OrderStatusResponse } from "@/types/domain/checkout";
import type { CartCheckoutSnapshot } from "@/lib/cart/checkout-snapshot";
import { useSession } from "@/contexts/SessionContext";
import { useViewGrant } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/view-grant";
import { captureProductAddedToCart } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/triggers";
import { withRequestDeadline } from "@/lib/http/request-deadline";
import { readJsonResponse } from "@/lib/http/read-json-response";

type ValidationStatus = "idle" | "loading" | "error";
interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">) => Promise<boolean>;
  removeItem: (productId: string, variantId: string) => Promise<boolean>;
  updateQuantity: (
    productId: string,
    variantId: string,
    quantity: number,
  ) => Promise<boolean>;
  setCartItems: (items: CartItem[]) => Promise<boolean>;
  clearCart: () => Promise<boolean>;
  itemCount: number;
  total: number;
  isReady: boolean;
  hasCartView: boolean;
  validationStatus: ValidationStatus;
  retryValidation: () => void;
  writeError: string | null;
  writePending: boolean;
  captureCheckoutSnapshot: () => CartCheckoutSnapshot;
  bindCheckoutSnapshot: (
    orderId: string,
    snapshot: CartCheckoutSnapshot,
  ) => Promise<boolean>;
  consumeConfirmedOrder: (
    order: OrderStatusResponse,
    onUpdateUnavailable?: () => void,
  ) => Promise<boolean>;
}
const cartContext = createContext<CartContextType | null>(null);
const empty: CartItem[] = [];

export function CartProvider({
  children,
}: {
  children: ReactNode;
  userId?: string | null;
}) {
  const { user, isLoading, isSessionUnavailable, refreshSession, isIdentityCurrent } =
    useSession();
  const grant = useViewGrant();
  const currentGrant = useRef(grant);
  useLayoutEffect(() => {
    currentGrant.current = grant;
  }, [grant]);
  const owner = user?.id ?? null;
  const unresolved = Boolean(isLoading || isSessionUnavailable);
  const cart = useMemo(
    () => (unresolved ? null : new CartService(owner)),
    [owner, unresolved],
  );
  const active = useRef<CartService | null>(null);
  const [view, setView] = useState<
    (CartView & { cart: CartService; readable: boolean }) | null
  >(null);
  const [error, setError] = useState<{ cart: CartService; message: string } | null>(null);
  const [validation, setValidation] = useState<{
    cart: CartService;
    status: ValidationStatus;
    hydrationFailed?: boolean;
  } | null>(null);
  const writer = useRef<CartService | null>(null);
  const [saving, setSaving] = useState<CartService | null>(null);
  const request = useRef<AbortController | null>(null);
  const current = useCallback(
    () => Boolean(cart && active.current === cart && isIdentityCurrent(cart.owner)),
    [cart, isIdentityCurrent],
  );
  useLayoutEffect(() => {
    active.current = cart;
    return () => {
      active.current = null;
      writer.current = null;
      request.current?.abort();
      request.current = null;
    };
  }, [cart]);

  const reload = useCallback(() => {
    if (!cart || !current()) return;
    const next = cart.read();
    // A successful primary read recovers an earlier hydration failure. Stock validation has its own retry.
    setValidation((previous) =>
      previous?.cart === cart && previous.hydrationFailed ? null : previous,
    );
    setView((previous) =>
      previous?.cart === cart && previous.readable && previous.revision === next.revision
        ? previous
        : { ...next, cart, readable: true },
    );
    return next;
  }, [cart, current]);

  const validate = useCallback(async () => {
    if (!cart || !current()) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const owns = () => current() && request.current === controller;
    let revision: string | null | undefined;
    try {
      const start = cart.read();
      revision = start.revision;
      if (!start.items.length) {
        setValidation({ cart, status: "idle" });
        return;
      }
      setValidation({ cart, status: "loading" });
      const result = await withRequestDeadline(async (signal) => {
        const response = await fetch("/api/cart/validate", {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: start.items.map(({ productId, variantId, quantity }) => ({
              productId,
              variantId,
              quantity,
            })),
          }),
        });
        return readJsonResponse<{ items: CartItem[] }>(
          response,
          "Could not check your cart",
        );
      }, controller.signal);
      if (!owns()) return;
      if (cart.read().revision === start.revision) {
        if (!Array.isArray(result?.items)) throw Error("Invalid cart response");
        const saved = await cart.setCart(result.items, owns, start.revision);
        if (!saved && owns() && cart.read().revision === start.revision)
          throw Error("Could not save cart");
      }
      if (owns()) {
        reload();
        setValidation({ cart, status: "idle" });
      }
    } catch {
      if (owns()) {
        let stale = false;
        try {
          stale = revision !== undefined && cart.read().revision !== revision;
        } catch {
          /* Storage is unavailable. */
        }
        setValidation({ cart, status: stale ? "idle" : "error" });
      }
    } finally {
      if (owns()) request.current = null;
    }
  }, [cart, current, reload]);

  const hydrate = useCallback(async () => {
    if (!cart || !current()) return;
    try {
      if (!(await cart.hydrate(current))) throw Error("Could not load cart");
      if (current()) {
        reload();
        void validate();
      }
    } catch {
      if (current()) setValidation({ cart, status: "error", hydrationFailed: true });
    }
  }, [cart, current, reload, validate]);
  useEffect(() => {
    if (!cart) return;
    const onChange = () => {
      try {
        reload();
      } catch {
        if (current()) {
          setView((previous) =>
            previous?.cart === cart ? { ...previous, readable: false } : previous,
          );
          setValidation({ cart, status: "error", hydrationFailed: true });
        }
      }
    };
    const onLocal = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (!key) {
        void hydrate();
      } else if (key === cart.key) onChange();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== cart.key) return;
      // Re-read the current value. Queued notifications can be older than the next write.
      void cart.hydrate(current).then((ok) => {
        if (ok) onChange();
        else if (current()) {
          setView((previous) =>
            previous?.cart === cart ? { ...previous, readable: false } : previous,
          );
          setValidation({ cart, status: "error", hydrationFailed: true });
        }
      });
    };
    const open = () => void validate();
    const visible = () => {
      if (document.visibilityState === "visible") void validate();
    };
    window.addEventListener("cartUpdated", onLocal);
    window.addEventListener("storage", onStorage);
    window.addEventListener("openCart", open);
    document.addEventListener("visibilitychange", visible);
    queueMicrotask(() => void hydrate());
    return () => {
      window.removeEventListener("cartUpdated", onLocal);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("openCart", open);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [cart, current, hydrate, reload, validate]);

  const hasCartView = Boolean(view && view.cart.owner === owner);
  const ready = Boolean(cart && view?.cart === cart && view.readable);
  const items = hasCartView && view ? view.items : empty;
  const revision = view?.revision;
  const write = async (operation: (service: CartService) => Promise<boolean>) => {
    if (!cart || !current() || !ready || writer.current === cart) return false;
    writer.current = cart;
    setSaving(cart);
    const saved = await operation(cart);
    if (writer.current === cart) {
      writer.current = null;
      setSaving(null);
    }
    if (current()) {
      if (saved) setError(null);
      else {
        let message = "Could not save your cart. Check browser storage and try again.";
        try {
          const latest = reload();
          if (latest && latest.revision !== revision)
            message = "Your cart changed. Review the current quantities and try again.";
        } catch {
          /* Keep the displayed basket for recovery. */
        }
        setError({ cart, message });
      }
    }
    return saved;
  };
  const consumeConfirmedOrder = useCallback(
    async (order: OrderStatusResponse, onUpdateUnavailable?: () => void) =>
      Boolean(
        cart &&
          current() &&
          (await cart.consumeConfirmedOrder(order, current, onUpdateUnavailable)),
      ),
    [cart, current],
  );
  return (
    <cartContext.Provider
      value={{
        items,
        isReady: ready,
        hasCartView,
        itemCount: items.reduce((n, x) => n + x.quantity, 0),
        total: items.reduce((n, x) => n + x.priceCents * x.quantity, 0),
        validationStatus: isLoading
          ? "loading"
          : isSessionUnavailable
            ? "error"
            : validation?.cart === cart && validation
              ? validation.status
              : "idle",
        retryValidation: () => {
          if (isSessionUnavailable) void refreshSession();
          else if (ready) void validate();
          else if (cart) {
            setValidation({ cart, status: "loading" });
            void hydrate();
          }
        },
        writeError: error && error.cart === cart ? error.message : null,
        writePending: Boolean(cart && saving === cart),
        addItem: async (item) => {
          const originalGrant = currentGrant.current;
          const saved = await write((service) => service.addItem(item, current));
          if (
            saved &&
            current() &&
            originalGrant &&
            currentGrant.current === originalGrant
          )
            captureProductAddedToCart(item.productId, item.variantId);
          return saved;
        },
        updateQuantity: (productId, variantId, quantity) =>
          write((service) =>
            service.updateQuantity(productId, variantId, quantity, current, revision),
          ),
        removeItem: (productId, variantId) =>
          write((service) => service.removeItem(productId, variantId, current, revision)),
        clearCart: () => write((service) => service.clearCart(current, revision)),
        setCartItems: (next) =>
          write((service) => service.setCart(next, current, revision)),
        captureCheckoutSnapshot: () => {
          if (
            !current() ||
            !ready ||
            !cart ||
            writer.current === cart ||
            revision === undefined
          )
            throw Error("Your cart is still loading.");
          return cart.captureCheckoutSnapshot(revision);
        },
        bindCheckoutSnapshot: async (id, snapshot) =>
          Boolean(
            cart && current() && (await cart.bindCheckoutSnapshot(id, snapshot, current)),
          ),
        consumeConfirmedOrder,
      }}
    >
      {children}
    </cartContext.Provider>
  );
}
export function useCart() {
  const context = useContext(cartContext);
  if (!context) throw Error("useCart must be used within CartProvider");
  return context;
}
