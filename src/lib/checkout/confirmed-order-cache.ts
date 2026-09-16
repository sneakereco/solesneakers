import type { OrderStatusResponse } from "@/types/domain/checkout";

const key = (orderId: string) => `checkout:confirmed:${orderId}`;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isConfirmedOrder(value: unknown, orderId: string): value is OrderStatusResponse {
  if (!value || typeof value !== "object") return false;
  const order = value as Partial<OrderStatusResponse>;
  return (
    order.id === orderId &&
    order.status === "paid" &&
    typeof order.subtotal === "number" &&
    typeof order.shipping === "number" &&
    typeof order.tax === "number" &&
    typeof order.total === "number" &&
    (order.fulfillment === "ship" || order.fulfillment === "pickup") &&
    typeof order.updatedAt === "string" &&
    Array.isArray(order.events) &&
    typeof order.supportEmail === "string"
  );
}

export function storeConfirmedOrder(
  order: OrderStatusResponse,
  storage: Storage | null = browserStorage(),
): void {
  try {
    if (storage && order.status === "paid") {
      storage.setItem(key(order.id), JSON.stringify(order));
    }
  } catch {
    // This cache only removes a redundant fetch; it must never block checkout.
  }
}

export function readConfirmedOrder(
  orderId: string,
  storage: Storage | null = browserStorage(),
): OrderStatusResponse | null {
  try {
    if (!storage) return null;
    const storageKey = key(orderId);
    const raw = storage.getItem(storageKey);
    storage.removeItem(storageKey);
    if (!raw) return null;
    const order: unknown = JSON.parse(raw);
    return isConfirmedOrder(order, orderId) ? order : null;
  } catch {
    return null;
  }
}
