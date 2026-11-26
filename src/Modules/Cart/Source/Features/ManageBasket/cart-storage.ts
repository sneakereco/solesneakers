"use client";

import {
  maxSavedCount,
  maxSavedLength,
  decodeSavedBasket,
  SavedBasketLimitError,
} from "./decode-saved-basket";
import { needsBasketReview } from "../../Contracts/Basket";
import type {
  BasketMutationResult,
  BasketReviewActions,
  StockConflict,
  BasketRepairReason,
  BasketQuantityUpdate,
  CartItem,
  CartPurchaseActions,
  CheckoutCaptureRequest,
  CaptureResult,
  ConsumptionResult,
  PurchaseLine,
} from "../../Contracts/Basket";
import type { ValidationOrder } from "../ValidateBasket/validation-contract";
import { requestValidation } from "../ValidateBasket/request-validation";

import {
  PurchaseProofs,
  captureLines,
  contextOrigin,
  decodeUnits,
  freshUnits,
  pairKey,
  projection,
  resizeUnits,
  sameProjection,
  subset,
  subtractRows,
  validId,
  type SavedLine,
} from "./purchase-capture";

type StoredVersion = {
  raw: string | null;
  revision: string | null;
};
type Snapshot = ReturnType<typeof decodeSavedBasket> & StoredVersion;
export type BasketView = {
  review: BasketReviewActions;
  items: CartItem[];
  writable: boolean;
  purchases: CartPurchaseActions;
  hasUnreadableItems: boolean;
  repairReason: BasketRepairReason;
};
function unavailablePurchase(signal?: AbortSignal): { status: "stale" | "unavailable" } {
  return { status: signal?.aborted ? "stale" : "unavailable" };
}
export const unavailablePurchases: CartPurchaseActions = {
  captureForCheckout: (_request, signal) => Promise.resolve(unavailablePurchase(signal)),
  bindPreparedOrder: () => Promise.resolve(false),
  consumeConfirmedPurchase: (_order, _items, signal) =>
    Promise.resolve(unavailablePurchase(signal)),
};
const unavailableEdit = () => Promise.resolve({ status: "unavailable" } as const);
export const unavailableReview: BasketReviewActions = {
  recheckAvailability: () => Promise.resolve(false),
  resetSavedBasket: unavailableEdit,
  applyStockConflicts: unavailableEdit,
  acceptPrice: unavailableEdit,
  scopeValidationToOrder: () => {},
};
class OversizedBasket extends SavedBasketLimitError {
  constructor(
    error: SavedBasketLimitError,
    readonly version: StoredVersion,
    readonly legacy?: string,
  ) {
    super(error.reason);
  }
}
const sameSnapshot = (a: StoredVersion, b: StoredVersion) =>
  a.raw === b.raw && a.revision === b.revision;
// Legacy migration can touch the shared rdk_cart key as well as an account key.
const ACCOUNT_WRITE_LOCK = "rdk_cart";

function resize(row: SavedLine, item: CartItem): SavedLine {
  if (!row.units) return { item, units: row.units };
  const units = resizeUnits(row.units, row.item.quantity, item.quantity);
  return { item, units: decodeUnits(units, item.quantity) };
}
function initialize(row: SavedLine): SavedLine {
  return row.units ? row : { item: row.item, units: freshUnits(row.item.quantity) };
}
export class BasketStorage {
  private readonly key: string;
  private readonly revisionKey: string;
  private connection?: AbortController;
  private listener?: (view: BasketView) => void;
  private pending?: Snapshot;
  private published?: Snapshot;
  private readonly proofKey: string;

  private blocked = false;
  private repair?: OversizedBasket;
  private scope?: ValidationOrder;
  constructor(
    private readonly userId: string | null,
    private readonly observed: () => boolean,
  ) {
    this.key = userId ? "rdk_cart_user_" + userId : "rdk_cart_session";
    this.revisionKey = this.key + ":revision";
    this.proofKey = this.key + ":purchase-v1";
  }
  private get area() {
    return this.userId ? window.localStorage : window.sessionStorage;
  }

  private async atomic<T>(
    operation: () => T,
    connection = this.connection,
    caller?: AbortSignal,
    options: { allowBlocked?: boolean; requireLock?: boolean } = {},
  ): Promise<T | undefined> {
    if (
      (!options.allowBlocked && this.blocked) ||
      !connection ||
      connection !== this.connection ||
      connection.signal.aborted ||
      caller?.aborted ||
      !this.observed()
    )
      return;
    // A caller may withdraw this request without disconnecting the basket.
    const queue = this.userId && caller ? new AbortController() : undefined;
    const cancel = () => queue?.abort();
    try {
      if (!this.userId && !options.requireLock) return operation();
      if (queue) {
        connection.signal.addEventListener("abort", cancel);
        caller!.addEventListener("abort", cancel);
      }
      return await navigator.locks.request(
        ACCOUNT_WRITE_LOCK,
        { signal: queue?.signal ?? connection.signal },
        () => {
          if (
            (options.allowBlocked || !this.blocked) &&
            this.connection === connection &&
            !connection.signal.aborted &&
            !caller?.aborted &&
            this.observed()
          )
            return operation();
        },
      );
    } catch (error) {
      if (
        queue?.signal.aborted &&
        error instanceof DOMException &&
        error.name === "AbortError"
      )
        return;
      if (this.connection === connection && !connection.signal.aborted) {
        this.blocked = true;
        const repair = error instanceof OversizedBasket ? error : undefined;
        this.repair = repair;
        if (!repair) connection.abort();
        this.pending = undefined;
        this.published = undefined;
        this.listener?.({
          review: repair
            ? {
                ...unavailableReview,
                resetSavedBasket: () => this.reset(repair, connection),
              }
            : unavailableReview,
          items: [],
          writable: false,
          purchases: unavailablePurchases,
          hasUnreadableItems: false,
          repairReason: error instanceof SavedBasketLimitError ? error.reason : null,
        });
      }
    } finally {
      if (queue) {
        connection.signal.removeEventListener("abort", cancel);
        caller!.removeEventListener("abort", cancel);
      }
    }
  }
  private storedVersion(): StoredVersion {
    return {
      raw: this.area.getItem(this.key),
      revision: this.userId ? this.area.getItem(this.revisionKey) : null,
    };
  }
  private read(): Snapshot {
    const version = this.storedVersion();
    try {
      return { ...version, ...decodeSavedBasket(version.raw) };
    } catch (error) {
      if (error instanceof SavedBasketLimitError)
        throw new OversizedBasket(error, version);
      throw error;
    }
  }
  private persist(raw: string, eligible = this.observed, expected?: StoredVersion) {
    // Fence the old snapshot first. A failed data write can invalidate validation,
    // but cannot make an older revision eligible again.
    if ((expected && !sameSnapshot(expected, this.storedVersion())) || !eligible())
      return false;
    const revision = this.userId ? crypto.randomUUID() : null;
    if (revision !== null) this.area.setItem(this.revisionKey, revision);
    // A legacy writer can change either key without joining our Web Lock.
    if (
      (expected &&
        !sameSnapshot({ raw: expected.raw, revision }, this.storedVersion())) ||
      !eligible()
    )
      return false;
    this.area.setItem(this.key, raw);
    return { raw, revision };
  }
  private migrateLegacyAccount() {
    if (!this.userId) return;
    const legacy = this.area.getItem("rdk_cart");
    if (!legacy) return;
    if (!this.observed()) return;
    const version = this.storedVersion();
    const hasAccountCart = version.raw !== null;
    try {
      decodeSavedBasket(legacy);
    } catch (error) {
      if (error instanceof SavedBasketLimitError) {
        if (hasAccountCart) return;
        throw new OversizedBasket(error, version, legacy);
      }
      throw error;
    }
    if (!hasAccountCart && !this.persist(legacy)) return;
    if (!this.observed()) return;
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
    this.published = undefined;
    this.repair = undefined;
    // Invalidate a queued repair immediately. Reopening a blocked cart still
    // requires a fresh verified observation through Retry cart access.
    if (this.blocked) return;
    void this.atomic(() => this.sync(this.read()));
  };
  private async reset(
    repair: OversizedBasket,
    generation: AbortController,
  ): Promise<BasketMutationResult> {
    const eligible = () =>
      this.repair === repair &&
      this.connection === generation &&
      !generation.signal.aborted &&
      this.observed() &&
      (repair.legacy === undefined || this.area.getItem("rdk_cart") === repair.legacy);
    const saved = await this.atomic(
      () => {
        const beforeReset = () =>
          eligible() && sameSnapshot(repair.version, this.storedVersion());
        if (!beforeReset()) return false;
        // Keep bound orders available for exact settlement and receipt replay. A reset
        // retires starts before emptying the basket so a partial write cannot revive one.
        if (this.area.getItem(this.proofKey) !== null) {
          const origin = contextOrigin();
          if (!origin) return false;
          const ledger = this.proofs(origin, beforeReset);
          if (ledger && !ledger.retireBasketStarts()) return false;
        }
        const committed = this.persist("[]", eligible, repair.version);
        if (!committed || !eligible() || !sameSnapshot(committed, this.storedVersion()))
          return false;
        this.sync(this.read());
        return true;
      },
      generation,
      undefined,
      { allowBlocked: true, requireLock: true },
    );
    return { status: saved ? "saved" : "stale" };
  }
  private sync(snapshot: Snapshot) {
    this.blocked = false;
    this.repair = undefined;
    if (this.pending && !sameSnapshot(this.pending, snapshot)) this.pending = undefined;
    this.published = snapshot;
    const generation = this.connection;
    const eligible = (signal?: AbortSignal) => () =>
      this.connection === generation &&
      !generation?.signal.aborted &&
      !signal?.aborted &&
      this.observed();
    this.listener?.({
      review: {
        ...unavailableReview,
        recheckAvailability: () => this.validate(true),
        scopeValidationToOrder: (order) => {
          if (eligible()()) {
            this.scope = { ...order };
            this.pending = undefined;
          }
        },
        applyStockConflicts: (conflicts, recoveryRequired) =>
          this.reviewEdit(snapshot, (rows) =>
            this.markConflicts(rows, conflicts, recoveryRequired),
          ),
        acceptPrice: (line) =>
          this.reviewEdit(snapshot, (rows) =>
            rows.map((row) => {
              if (
                pairKey(row.item) !== pairKey(line) ||
                row.item.priceCents !== line.priceCents
              )
                return row;
              const item = { ...row.item };
              delete item.previousPriceCents;
              return { ...row, item };
            }),
          ),
      },
      items: snapshot.items,
      hasUnreadableItems: !snapshot.complete,
      repairReason: null,
      writable: true,
      purchases: {
        captureForCheckout: async (request, signal) =>
          (await this.atomic(
            () => this.capture(snapshot, request, eligible(signal)),
            generation,
            signal,
          )) ?? unavailablePurchase(signal),
        bindPreparedOrder: async (captureId, orderId, signal) =>
          (await this.atomic(
            () => this.bind(captureId, orderId, eligible(signal)),
            generation,
            signal,
          )) ?? false,
        consumeConfirmedPurchase: async (orderId, items, signal) =>
          (await this.atomic(
            () => this.consume(orderId, items, eligible(signal)),
            generation,
            signal,
          )) ?? unavailablePurchase(signal),
      },
    });
  }
  private reviewEdit(
    snapshot: Snapshot,
    edit: (rows: SavedLine[]) => SavedLine[] | undefined,
  ) {
    return this.mutate(() => {
      if (
        this.published !== snapshot ||
        !snapshot.complete ||
        !sameSnapshot(snapshot, this.storedVersion())
      )
        return false;
      const rows = edit(snapshot.rows);
      return (
        !!rows &&
        this.save(
          rows,
          false,
          () => this.observed() && this.published === snapshot,
          snapshot,
        )
      );
    });
  }
  private markConflicts(
    rows: SavedLine[],
    conflicts: readonly StockConflict[],
    recoveryRequired = false,
  ) {
    const byPair = new Map(conflicts.map((c) => [pairKey(c), c]));
    if (!byPair.size || byPair.size !== conflicts.length) return;
    const next = rows.map((row) => {
      const key = pairKey(row.item),
        c = byPair.get(key);
      if (
        !c ||
        c.requestedQuantity !== row.item.quantity ||
        c.availableQuantity >= row.item.quantity
      )
        return row;
      byPair.delete(key);
      return {
        ...row,
        item: {
          ...row.item,
          availability: c.reason,
          maxStock: c.availableQuantity,
          ...(recoveryRequired ? { orderScoped: true as const } : {}),
        },
      };
    });
    if (!byPair.size) return next;
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
      this.scope = undefined;
      this.repair = undefined;
      this.connection = undefined;
      this.listener = undefined;
      this.published = undefined;
      this.pending = undefined;
    };
  }
  async validate(force = false): Promise<boolean> {
    const snapshot = await this.atomic(() => {
      const current = this.read();
      // A background refresh cannot rewrite a partially recoverable basket.
      if (
        !current.complete ||
        current.rows.some((r) => r.units === null) ||
        (current.rows.some((r) => !r.units) &&
          this.area.getItem(this.proofKey) !== null) ||
        !current.items.length ||
        (!force && this.pending && sameSnapshot(this.pending, current))
      )
        return;
      this.pending = current;
      return current;
    });
    if (!snapshot || this.pending !== snapshot) return false;
    try {
      const accepted = await requestValidation(snapshot.items, this.scope);
      if (this.pending !== snapshot) return false;
      return (
        (await this.atomic(() => {
          if (this.pending !== snapshot) return;
          const current = this.read();
          if (!sameSnapshot(snapshot, current)) this.sync(current);
          else if (accepted) {
            const originals = new Map(
              current.rows.map((row) => [pairKey(row.item), row]),
            );
            const rows = accepted.map((item) => ({
              ...originals.get(pairKey(item))!,
              item,
            }));
            if (accepted.every((item, index) => item === snapshot.items[index]))
              return true;
            return (
              this.save(
                rows,
                false,
                () => this.pending === snapshot && this.observed(),
                snapshot,
              ) === true
            );
          }
        })) === true
      );
    } finally {
      if (this.pending === snapshot) this.pending = undefined;
    }
  }
  private save(
    rows: SavedLine[],
    invalidateProof = false,
    eligible = this.observed,
    expected?: StoredVersion,
  ) {
    if (!this.connection || this.connection.signal.aborted || !this.observed())
      return false;
    if (rows.length > maxSavedCount) return "unavailable" as const;
    const raw = JSON.stringify(
      rows.map(({ item, units }) =>
        units === undefined ? item : { ...item, _cartUnits: units },
      ),
    );
    if (raw.length > maxSavedLength) return "unavailable" as const;
    if (!eligible()) return false;
    if (invalidateProof) this.area.removeItem(this.proofKey);
    const committed = this.persist(raw, eligible, expected);
    if (!committed) return false;
    this.pending = undefined;
    const observed = this.read();
    this.sync(observed);
    return !expected || sameSnapshot(committed, observed);
  }
  private mutation(snapshot: Snapshot, rows: SavedLine[]) {
    const hasProof = this.area.getItem(this.proofKey) !== null;
    const hasLineage = snapshot.rows.some((r) => r.units !== undefined);
    // Legacy baskets initialize lazily. This also permits a reducing edit near the
    // ordinary storage limit before checkout has ever allocated unit identities.
    if (!hasProof && !hasLineage) return this.save(rows);
    const invalidate =
      !snapshot.complete ||
      snapshot.raw === null ||
      snapshot.rows.some((r) => !r.units) ||
      rows.some((r) => r.units === null);
    return this.save(
      rows.map((row) => initialize(snapshot.complete ? row : { item: row.item })),
      hasProof && invalidate,
    );
  }
  private async mutate(
    operation: () => boolean | "unavailable",
  ): Promise<BasketMutationResult> {
    const saved = await this.atomic(operation);
    if (saved === true) return { status: "saved" };
    if (saved === "unavailable") return { status: "unavailable" };
    return { status: this.blocked ? "unavailable" : "stale" };
  }
  async setItems(items: CartItem[]) {
    return this.mutate(() => {
      const current = this.read();
      if (items.length > maxSavedCount) return "unavailable";
      const raw = JSON.stringify(items);
      if (raw.length > maxSavedLength) return "unavailable";
      const clean = decodeSavedBasket(raw);
      if (!clean.complete) return false;
      // A deliberate replacement allocates new units even for identical public rows.
      return this.mutation(
        current,
        clean.items.map((item) => ({ item })),
      );
    });
  }
  async addItem(item: Omit<CartItem, "quantity">) {
    if (item.maxStock !== undefined && item.maxStock <= 0)
      return { status: "stale" } as const;
    return this.mutate(() => {
      const current = this.read();
      const row = current.rows.find((r) => pairKey(r.item) === pairKey(item));
      if (!row) {
        const raw = JSON.stringify([{ ...item, quantity: 1 }]);
        if (raw.length > maxSavedLength) return "unavailable";
        const clean = decodeSavedBasket(raw);
        return (
          clean.complete &&
          this.mutation(current, [...current.rows, { item: clean.items[0] }])
        );
      }
      if (row.item.availability || row.item.orderScoped) return false;
      const maxStock = item.maxStock ?? row.item.maxStock;
      const quantity = Math.min(row.item.quantity + 1, maxStock ?? Infinity);
      if (
        !Number.isSafeInteger(quantity) ||
        (quantity === row.item.quantity && maxStock === row.item.maxStock)
      )
        return false;
      const resized = resize(row, { ...row.item, quantity, maxStock });
      if (row.units && !resized.units) return "unavailable";
      const result = this.mutation(
        current,
        current.rows.map((r) => (r === row ? resized : r)),
      );
      return result === true ? quantity > row.item.quantity : result;
    });
  }
  async removeItem(productId: string, variantId: string) {
    return this.mutate(() => {
      const current = this.read();
      const kept = current.rows.filter(
        ({ item }) => item.productId !== productId || item.variantId !== variantId,
      );
      return kept.length !== current.rows.length && this.mutation(current, kept);
    });
  }
  async updateQuantity(
    productId: string,
    variantId: string,
    quantity: BasketQuantityUpdate,
  ) {
    return this.mutate(() => {
      const current = this.read();
      const row = current.rows.find(
        (r) => r.item.productId === productId && r.item.variantId === variantId,
      );
      if (!row) return false;
      const next =
        typeof quantity === "number" ? quantity : row.item.quantity + quantity.adjustBy;
      if (row.item.orderScoped) return false;
      const clamped = row.item.availability
        ? next
        : Math.min(next, row.item.maxStock ?? Infinity);
      if (row.item.availability && next > row.item.quantity) return false;
      if (!Number.isSafeInteger(clamped) || clamped === row.item.quantity) return false;
      if (clamped <= 0)
        return this.mutation(
          current,
          current.rows.filter((r) => r !== row),
        );
      const resized = resize(row, { ...row.item, quantity: clamped });
      if (row.units && !resized.units) return "unavailable";
      return this.mutation(
        current,
        current.rows.map((r) => (r === row ? resized : r)),
      );
    });
  }

  private proofs(origin: string, eligible: () => boolean) {
    return PurchaseProofs.read(
      this.area,
      this.proofKey,
      this.userId ? undefined : origin,
      eligible,
    );
  }
  private capture(
    view: Snapshot,
    request: CheckoutCaptureRequest,
    eligible: () => boolean,
  ): CaptureResult {
    const { mode, attemptKey } = request;
    const expected = projection(request.expectedItems);
    if (!expected || !validId(attemptKey) || (mode !== "new" && mode !== "resume"))
      return { status: "mismatch" };
    const current = this.read();
    if (
      this.published !== view ||
      !sameSnapshot(current, view) ||
      !current.complete ||
      !sameProjection(
        current.rows.map((row) => row.item),
        expected,
      )
    )
      return { status: "mismatch" };
    if (mode === "new" && current.items.some(needsBasketReview))
      return { status: "mismatch" };
    if (!eligible()) return { status: "stale" };
    const origin = contextOrigin();
    if (!origin) return { status: "unavailable" };
    if (current.rows.some((r) => r.units === null)) return { status: "corrupt" };
    // A verified new capture can replace unreadable evidence in its final insert.
    // Building an empty ledger here does not rewrite bytes on mismatch or failure.
    let captureView: Snapshot | undefined = view;
    const canAssociate = () =>
      captureView !== undefined &&
      this.published === captureView &&
      sameSnapshot(captureView, this.storedVersion()) &&
      eligible();
    const ledger =
      this.proofs(origin, canAssociate) ??
      (mode === "new"
        ? PurchaseProofs.empty(this.area, this.proofKey, canAssociate)
        : undefined);
    if (!ledger) return { status: "corrupt" };
    if (!canAssociate()) return { status: "stale" };
    const existing = ledger.records.find((r) => r.attemptKey === attemptKey);
    if (!existing && mode === "resume") return { status: "missing" };
    if (existing && (existing.origin !== origin || existing.stage !== "pending"))
      return { status: "stale" };
    if (current.rows.some((r) => !r.units) && ledger.records.length)
      return { status: "corrupt" };
    if (existing && existing.stage === "pending") {
      if (!sameProjection(existing.lines, expected)) return { status: "mismatch" };
      return {
        status: "captured",
        captureId: existing.captureId,
        items: projection(existing.lines)!,
      };
    }
    const needsLineage = current.rows.some((r) => !r.units);
    const rows = current.rows.map(initialize);
    const lines = captureLines(rows);
    if (!lines) return { status: "mismatch" };
    if (!eligible()) return { status: "stale" };
    if (needsLineage) {
      if (this.save(rows, false, eligible, current) !== true)
        return { status: "unavailable" };
      captureView = this.published;
    }
    const captureId = crypto.randomUUID();
    if (
      !ledger.insert({
        stage: "pending",
        at: Date.now(),
        origin,
        attemptKey,
        captureId,
        lines,
      })
    )
      return { status: "unavailable" };
    return { status: "captured", captureId, items: projection(lines)! };
  }
  private bind(captureId: string, orderId: string, eligible: () => boolean) {
    if (!eligible() || !validId(captureId) || !validId(orderId)) return false;
    const origin = contextOrigin();
    if (!origin) return false;
    this.read(); // Also fence an oversized basket changed since the last observation.
    const ledger = this.proofs(origin, eligible);
    const record = ledger?.records.find((r) => r.captureId === captureId);
    if (!ledger || !record || record.stage !== "pending" || record.origin !== origin)
      return false;
    if (!eligible()) return false;
    if (record.orderId) return record.orderId === orderId;
    if (ledger.records.some((r) => r.orderId === orderId)) return false;
    return ledger.replace(record, { ...record, orderId });
  }
  private consume(
    orderId: string,
    input: readonly PurchaseLine[],
    eligible: () => boolean,
  ): ConsumptionResult {
    const purchased = projection(input);
    if (!validId(orderId) || !purchased) return { status: "mismatch" };
    const origin = contextOrigin();
    if (!origin) return { status: "unavailable" };
    let journalView: StoredVersion | undefined;
    const ledger = this.proofs(
      origin,
      () =>
        journalView !== undefined &&
        sameSnapshot(journalView, this.storedVersion()) &&
        eligible(),
    );
    if (!ledger) return { status: "corrupt" };
    if (!eligible()) return { status: "stale" };
    const record = ledger.records.find((r) => r.orderId === orderId);
    if (!record) return { status: "missing" };
    if (record.stage === "retired") return { status: "stale" };
    if (record.stage !== "pending" && !sameProjection(record.purchased, purchased))
      return { status: "mismatch" };
    const matched = { status: "matched", attemptKey: record.attemptKey } as const;
    if (record.stage === "receipt") return matched;
    if (!subset(record, purchased)) return { status: "mismatch" };
    const current = this.read();
    if (!current.complete || current.raw === null) return { status: "corrupt" };
    journalView = current;
    const rows = subtractRows(current.rows, record, purchased);
    if (!rows) return { status: "corrupt" };
    if (!eligible()) return { status: "stale" };
    if (
      record.stage === "pending" &&
      !ledger.replace(record, { ...record, stage: "applying", orderId, purchased })
    )
      return { status: "unavailable" };
    if (
      rows.length !== current.rows.length ||
      rows.some((r, i) => r !== current.rows[i])
    ) {
      if (this.save(rows, false, eligible, current) !== true)
        return { status: "unavailable" };
      journalView = this.published;
    }
    return ledger.finish(record, orderId, purchased)
      ? matched
      : { status: "unavailable" };
  }
}
