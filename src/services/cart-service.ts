"use client";

import type { CartItem } from "@/types/domain/cart";
import type { OrderStatusResponse } from "@/types/domain/checkout";
import { classifyCheckoutOrderStatus } from "@/lib/checkout/checkout-order-state";
import {
  consumeUnits,
  decodeCart,
  displayItem,
  newCartId,
  sameLine,
  withUnits,
  type CartCheckoutSnapshot,
  type StoredLine,
} from "@/lib/cart/checkout-snapshot";

export type CartView = { items: CartItem[]; revision: string | null };
type Guard = () => boolean;

export class CartService {
  readonly key: string;
  constructor(readonly owner: string | null = null) {
    this.key = owner ? `rdk_cart_user_${owner}` : "rdk_cart_session";
  }

  private get storage() {
    return this.owner ? window.localStorage : window.sessionStorage;
  }

  read(): CartView {
    const revision = this.storage.getItem(this.key);
    return { items: decodeCart(revision).lines.map(displayItem), revision };
  }

  getCart() {
    return this.read().items;
  }

  private async locked(work: () => boolean): Promise<boolean> {
    try {
      if (!this.owner) return work(); // Session storage is tab-scoped; no await inside its commit.
      return await navigator.locks.request(this.key, work);
    } catch {
      return false;
    }
  }

  private save(previous: string | null, lines: StoredLine[]) {
    const storage = this.storage;
    if (storage.getItem(this.key) !== previous) return false;
    if (lines.length) lines[0] = { ...lines[0], cartRevision: newCartId() };
    const raw = JSON.stringify(lines, null, 1);
    storage.setItem(this.key, raw);
    if (storage.getItem(this.key) !== raw) return false;
    const items = lines.map(displayItem);
    window.dispatchEvent(
      new CustomEvent("cartUpdated", {
        detail: {
          key: this.key,
          items,
          count: items.reduce((sum, line) => sum + line.quantity, 0),
        },
      }),
    );
    return true;
  }

  async hydrate(active: Guard = () => true) {
    const hydrate = () =>
      this.locked(() => {
        if (!active()) return false;
        const storage = this.storage;
        const previous = storage.getItem(this.key);
        const legacy = this.owner ? storage.getItem("rdk_cart") : null;
        const { current, lines } = decodeCart(previous ?? legacy);
        if (
          (!current || (previous === null && legacy !== null)) &&
          !this.save(previous, lines)
        )
          return false;
        if (legacy !== null) storage.removeItem("rdk_cart");
        return true;
      });
    try {
      if (this.owner && this.storage.getItem("rdk_cart") !== null)
        return await navigator.locks.request("rdk_cart_migration", hydrate);
      return await hydrate();
    } catch {
      return false;
    }
  }

  private edit(
    change: (lines: StoredLine[]) => StoredLine[] | null,
    active: Guard,
    expected?: string | null,
  ) {
    return this.locked(() => {
      if (!active()) return false;
      const raw = this.storage.getItem(this.key);
      if (expected !== undefined && expected !== raw) return false;
      const { lines, current } = decodeCart(raw);
      const next = change(lines);
      if (next === lines && current) return true;
      return next !== null && this.save(raw, next);
    });
  }

  async addItem(item: Omit<CartItem, "quantity">, active: Guard = () => true) {
    let increased = false;
    const saved = await this.edit((lines) => {
      const old = lines.find((line) => sameLine(item, line));
      const before = old?.quantity ?? 0;
      const maxStock = item.maxStock ?? old?.maxStock;
      if (maxStock !== undefined && maxStock <= 0) return null;
      const quantity = Math.min(before + 1, maxStock ?? Infinity);
      increased = quantity > before;
      if (!increased && quantity === before && old?.maxStock === maxStock) return null;
      const next = withUnits({ ...(old ?? item), maxStock, quantity }, old);
      return old ? lines.map((line) => (line === old ? next : line)) : [...lines, next];
    }, active);
    return saved && increased;
  }

  removeItem(
    productId: string,
    variantId: string,
    active: Guard = () => true,
    expected?: string | null,
  ) {
    return this.edit(
      (lines) => lines.filter((line) => !sameLine(line, { productId, variantId })),
      active,
      expected,
    );
  }

  updateQuantity(
    productId: string,
    variantId: string,
    quantity: number,
    active: Guard = () => true,
    expected?: string | null,
  ) {
    return this.edit(
      (lines) => {
        const old = lines.find((line) => sameLine(line, { productId, variantId }));
        if (!old) return null;
        const next = Math.min(quantity, old.maxStock ?? Infinity);
        return lines.flatMap((line) =>
          line !== old
            ? [line]
            : next <= 0
              ? []
              : [withUnits({ ...line, quantity: next }, old)],
        );
      },
      active,
      expected,
    );
  }

  clearCart(active: Guard = () => true, expected?: string | null) {
    return this.edit(() => [], active, expected);
  }

  setCart(items: CartItem[], active: Guard = () => true, expected?: string | null) {
    return this.edit(
      (lines) => {
        const identical =
          items.length === lines.length &&
          items.every((item, index) => {
            const old = displayItem(lines[index]);
            return (Object.keys({ ...old, ...item }) as (keyof CartItem)[]).every(
              (key) => old[key] === item[key],
            );
          });
        return identical
          ? lines
          : items.map((item) =>
              withUnits(
                item,
                lines.find((line) => sameLine(item, line)),
              ),
            );
      },
      active,
      expected,
    );
  }

  captureCheckoutSnapshot(expected: string | null): CartCheckoutSnapshot {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      throw Error("Could not read your cart. Check browser storage and try again.");
    }
    const { lines, current } = decodeCart(raw);
    if (!current || raw !== expected || !lines.length)
      throw Error("Your cart changed. Refresh it before checkout.");
    return {
      owner: this.owner,
      lines: lines.map(({ productId, variantId, unitsV1 }) => ({
        productId,
        variantId,
        unitsV1,
      })),
    };
  }

  bindCheckoutSnapshot(
    orderId: string,
    snapshot: CartCheckoutSnapshot,
    active: Guard = () => true,
  ) {
    return this.locked(() => {
      if (!active() || !orderId || snapshot.owner !== this.owner) return false;
      const storage = this.storage,
        key = this.bindingKey(orderId),
        value = JSON.stringify(snapshot);
      const existing = storage.getItem(key);
      if (existing !== null) return existing === value;
      storage.setItem(key, value);
      return storage.getItem(key) === value;
    });
  }

  private bindingKey(orderId: string) {
    return JSON.stringify([this.key, "checkout", orderId]);
  }

  consumeConfirmedOrder(order: OrderStatusResponse, active: Guard = () => true) {
    return this.edit((lines) => {
      if (
        !order.id ||
        classifyCheckoutOrderStatus(order.status) !== "paid" ||
        order.customerId !== this.owner ||
        !order.purchasedItems?.length
      )
        return null;
      const binding = this.storage.getItem(this.bindingKey(order.id));
      if (!binding) return null;
      const snapshot = JSON.parse(binding) as CartCheckoutSnapshot;
      return snapshot.owner === this.owner ? consumeUnits(lines, snapshot, order) : null;
    }, active);
  }
}
