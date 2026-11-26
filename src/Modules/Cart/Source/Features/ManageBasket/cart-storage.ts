"use client";

import {
  checkSavedCount,
  checkSavedLength,
  decodeSavedBasket,
  SavedBasketLimitError,
} from "./decode-saved-basket";
import type {
  BasketMutationResult,
  BasketRepairReason,
  BasketQuantityUpdate,
  CartItem,
} from "../../Contracts/Basket";
import { requestValidation } from "../ValidateBasket/request-validation";

type Snapshot = ReturnType<typeof decodeSavedBasket> & {
  raw: string | null;
  revision: string | null;
};
export type BasketView = {
  items: CartItem[];
  writable: boolean;
  hasUnreadableItems: boolean;
  repairReason: BasketRepairReason;
};
const sameSnapshot = (a: Snapshot, b: Snapshot) =>
  a.raw === b.raw && a.revision === b.revision;
// Legacy migration can touch the shared rdk_cart key as well as an account key.
const ACCOUNT_WRITE_LOCK = "rdk_cart";

export class BasketStorage {
  private readonly key: string;
  private readonly revisionKey: string;
  private connection?: AbortController;
  private listener?: (view: BasketView) => void;
  private pending?: Snapshot;

  private blocked = false;
  constructor(
    private readonly userId: string | null,
    private readonly observed: () => boolean,
  ) {
    this.key = userId ? "rdk_cart_user_" + userId : "rdk_cart_session";
    this.revisionKey = this.key + ":revision";
  }
  private get area() {
    return this.userId ? window.localStorage : window.sessionStorage;
  }

  private async atomic<T>(operation: () => T): Promise<T | undefined> {
    const connection = this.connection;
    if (!connection || connection.signal.aborted || !this.observed()) return;
    try {
      if (!this.userId) return operation();
      return await navigator.locks.request(
        ACCOUNT_WRITE_LOCK,
        { signal: connection.signal },
        () => {
          if (
            this.connection === connection &&
            !connection.signal.aborted &&
            this.observed()
          )
            return operation();
        },
      );
    } catch (error) {
      if (this.connection === connection && !connection.signal.aborted) {
        this.blocked = true;
        connection.abort();
        this.pending = undefined;
        this.listener?.({
          items: [],
          writable: false,
          hasUnreadableItems: false,
          repairReason: error instanceof SavedBasketLimitError ? error.reason : null,
        });
      }
    }
  }
  private read(): Snapshot {
    const raw = this.area.getItem(this.key);
    return {
      ...decodeSavedBasket(raw),
      raw,
      revision: this.userId ? this.area.getItem(this.revisionKey) : null,
    };
  }
  private persist(raw: string) {
    // Fence the old snapshot first. A failed data write can invalidate validation,
    // but cannot make an older revision eligible again.
    if (this.userId) this.area.setItem(this.revisionKey, crypto.randomUUID());
    this.area.setItem(this.key, raw);
  }
  private migrateLegacyAccount() {
    if (!this.userId) return;
    const legacy = this.area.getItem("rdk_cart");
    if (!legacy) return;
    if (!this.observed()) return;
    const hasAccountCart = this.area.getItem(this.key) !== null;
    try {
      decodeSavedBasket(legacy);
    } catch (error) {
      if (hasAccountCart && error instanceof SavedBasketLimitError) return;
      throw error;
    }
    if (!hasAccountCart) this.persist(legacy);
    this.area.removeItem("rdk_cart");
  }
  private readonly onStorage = (event: StorageEvent) => {
    if (this.connection?.signal.aborted) return;
    if (event.key !== null && event.key !== this.key && event.key !== this.revisionKey)
      return;
    // Even identical current bytes can follow two delivered edits from a legacy writer.
    try {
      if (event.storageArea !== this.area) return;
    } catch {
      /* atomic read reports loss of access */
    }
    this.pending = undefined;
    void this.atomic(() => {
      this.sync(this.read());
    });
  };
  private sync(snapshot: Snapshot) {
    if (this.pending && !sameSnapshot(this.pending, snapshot)) this.pending = undefined;
    this.listener?.({
      items: snapshot.items,
      writable: true,
      hasUnreadableItems: !snapshot.complete,
      repairReason: null,
    });
  }
  connect(listener: (view: BasketView) => void) {
    this.listener = listener;
    const connection = new AbortController();
    this.connection = connection;
    window.addEventListener("storage", this.onStorage);
    void this.atomic(() => {
      this.migrateLegacyAccount();
      this.sync(this.read());
      return true;
    }).then((ready) => {
      if (ready && this.connection === connection) void this.validate();
    });
    return () => {
      window.removeEventListener("storage", this.onStorage);
      connection.abort();
      this.connection = undefined;
      this.listener = undefined;
      this.pending = undefined;
    };
  }
  async validate() {
    const snapshot = await this.atomic(() => {
      const current = this.read();
      // A background refresh cannot rewrite a partially recoverable basket.
      if (
        !current.complete ||
        !current.items.length ||
        (this.pending && sameSnapshot(this.pending, current))
      )
        return;
      this.pending = current;
      return current;
    });
    if (!snapshot || this.pending !== snapshot) return;
    try {
      const accepted = await requestValidation(snapshot.items);
      if (this.pending !== snapshot) return;
      await this.atomic(() => {
        if (this.pending !== snapshot) return;
        const current = this.read();
        if (!sameSnapshot(snapshot, current)) this.sync(current);
        else if (accepted) this.save(accepted);
      });
    } finally {
      if (this.pending === snapshot) this.pending = undefined;
    }
  }
  private save(items: CartItem[]) {
    if (!this.connection || this.connection.signal.aborted || !this.observed())
      return false;
    checkSavedCount(items.length);
    const raw = JSON.stringify(items);
    checkSavedLength(raw.length);
    this.persist(raw);
    this.pending = undefined;
    this.listener?.({
      items,
      writable: true,
      hasUnreadableItems: false,
      repairReason: null,
    });
    return true;
  }
  private async mutate(operation: () => boolean): Promise<BasketMutationResult> {
    const saved = await this.atomic(operation);
    if (saved) return { status: "saved" };
    return { status: this.blocked ? "unavailable" : "stale" };
  }
  async setItems(items: CartItem[]) {
    return this.mutate(() => {
      // An explicit replacement can have waited behind another tab’s storage edit.
      this.read();
      return this.save(items);
    });
  }
  async addItem(item: Omit<CartItem, "quantity">) {
    if (item.maxStock !== undefined && item.maxStock <= 0)
      return { status: "stale" } as const;
    return this.mutate(() => {
      const items = this.read().items;
      const line = items.find(
        (i) => i.productId === item.productId && i.variantId === item.variantId,
      );
      if (!line) return this.save([...items, { ...item, quantity: 1 }]);
      const before = line.quantity;
      const previousLimit = line.maxStock;
      line.maxStock = item.maxStock ?? line.maxStock;
      line.quantity = Math.min(before + 1, line.maxStock ?? Infinity);
      if (line.quantity === before && line.maxStock === previousLimit) return false;
      return this.save(items) && line.quantity > before;
    });
  }
  async removeItem(productId: string, variantId: string) {
    return this.mutate(() => {
      const items = this.read().items;
      const remaining = items.filter(
        (line) => line.productId !== productId || line.variantId !== variantId,
      );
      return remaining.length !== items.length && this.save(remaining);
    });
  }
  async updateQuantity(
    productId: string,
    variantId: string,
    quantity: BasketQuantityUpdate,
  ) {
    return this.mutate(() => {
      const items = this.read().items;
      const line = items.find(
        (i) => i.productId === productId && i.variantId === variantId,
      );
      if (!line) return false;
      const next =
        typeof quantity === "number" ? quantity : line.quantity + quantity.adjustBy;
      const clamped = Math.min(next, line.maxStock ?? Infinity);
      if (line.quantity === clamped) return false;
      line.quantity = clamped;
      return this.save(line.quantity > 0 ? items : items.filter((i) => i !== line));
    });
  }
}
