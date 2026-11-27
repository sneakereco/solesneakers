import type { CartItem, CartLineIdentity } from "@/types/domain/cart";
import type { OrderStatusResponse } from "@/types/domain/checkout";

// Each increase creates a distinct batch. Offsets within a batch are never reused.
type UnitRange = { id: string; start: number; end: number };
export type StoredLine = CartItem & { unitsV1: UnitRange[]; cartRevision?: string };
export type CartCheckoutSnapshot = {
  owner: string | null;
  lines: Array<Pick<StoredLine, "productId" | "variantId" | "unitsV1">>;
};

export function newCartId() {
  // getRandomValues is also available to a guest cart on an HTTP development origin.
  return crypto.getRandomValues(new Uint32Array(4)).join("-");
}

export function sameLine(a: CartLineIdentity, b: CartLineIdentity) {
  return a.productId === b.productId && a.variantId === b.variantId;
}

export function displayItem(line: StoredLine): CartItem {
  const { unitsV1, cartRevision, ...item } = line;
  void unitsV1;
  void cartRevision;
  return item;
}

function quantity(ranges: UnitRange[]) {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
}

function prefix(ranges: UnitRange[], count: number): UnitRange[] {
  const result: UnitRange[] = [];
  for (const r of ranges) {
    if (count <= 0) break;
    const take = Math.min(count, r.end - r.start);
    result.push({ ...r, end: r.start + take });
    count -= take;
  }
  return result;
}

export function withUnits(item: CartItem, previous?: StoredLine): StoredLine {
  if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0)
    throw Error("Invalid cart quantity");
  const old = previous?.unitsV1 ?? [];
  const added = item.quantity - quantity(old);
  const unitsV1 =
    added > 0
      ? [...old, { id: newCartId(), start: 0, end: added }]
      : prefix(old, item.quantity);
  return { ...item, unitsV1 };
}

function validRanges(value: unknown): value is UnitRange[] {
  return (
    Array.isArray(value) &&
    value.every(
      (r) =>
        r &&
        typeof r.id === "string" &&
        r.id.length > 0 &&
        Number.isSafeInteger(r.start) &&
        Number.isSafeInteger(r.end) &&
        r.start >= 0 &&
        r.end > r.start,
    )
  );
}

export function decodeCart(raw: string | null) {
  const parsed: unknown = raw === null ? [] : JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (line) =>
        line &&
        typeof line.productId === "string" &&
        typeof line.variantId === "string" &&
        Number.isSafeInteger(line.quantity) &&
        line.quantity > 0,
    )
  )
    throw Error("Could not read cart");
  const lines = parsed as StoredLine[];
  // Old writers JSON.stringify the array without whitespace, including unknown metadata.
  const current =
    lines.length === 0 ||
    (raw === JSON.stringify(lines, null, 1) &&
      typeof lines[0].cartRevision === "string" &&
      lines.every(
        (line) => validRanges(line.unitsV1) && quantity(line.unitsV1) === line.quantity,
      ));
  return {
    lines: current ? lines : lines.map((line) => withUnits(displayItem(line))),
    current,
  };
}

export function consumeUnits(
  lines: StoredLine[],
  snapshot: CartCheckoutSnapshot,
  order: OrderStatusResponse,
): StoredLine[] | null {
  if (
    !Array.isArray(snapshot.lines) ||
    !Array.isArray(order.purchasedItems) ||
    !order.purchasedItems.every(
      (item) => item && Number.isSafeInteger(item.quantity) && item.quantity > 0,
    )
  )
    return null;
  let changed = false;
  const next = lines.flatMap((line) => {
    const captured = snapshot.lines.find((item) => sameLine(item, line));
    if (!captured || !validRanges(captured.unitsV1)) return [line];
    const purchased = order.purchasedItems!.reduce(
      (sum, item) => (sameLine(item, line) ? sum + item.quantity : sum),
      0,
    );
    // Cap the original capture first. Replaying a partial purchase selects identical IDs.
    const bought = prefix(captured.unitsV1, purchased);
    const unitsV1 = line.unitsV1.flatMap((range) => {
      const removed = bought.find(
        (r) => r.id === range.id && r.end > range.start && r.start < range.end,
      );
      if (!removed) return [range];
      changed = true;
      const kept: UnitRange[] = [];
      if (range.start < removed.start) kept.push({ ...range, end: removed.start });
      if (removed.end < range.end) kept.push({ ...range, start: removed.end });
      return kept;
    });
    const remaining = quantity(unitsV1);
    return remaining ? [{ ...line, quantity: remaining, unitsV1 }] : [];
  });
  return changed ? next : null;
}
