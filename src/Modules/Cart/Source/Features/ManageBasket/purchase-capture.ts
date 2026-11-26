import { z } from "zod";
import type { CartItem, PurchaseLine } from "../../Contracts/Basket";

type Range = [string, string];
export type Units = { id: string; high: string; ranges: Range[] };
export type SavedLine = { item: CartItem; units?: Units | null };

const uuid = z.uuid();
const offset = z.string().regex(/^(0|[1-9]\d{0,63})$/);
const maxRanges = 4096;
const maxLines = 1024;
const maxProofCharacters = 2 * 1024 * 1024;
const maximumAge = 7 * 24 * 60 * 60 * 1000;
const maximumRecords = 64;
// Reject oversized arrays before parsing their elements or constructing per-element errors.
function boundedArray<T extends z.ZodType>(element: T, maximum: number) {
  return z.preprocess(
    (value) => (Array.isArray(value) && value.length > maximum ? undefined : value),
    z.array(element).min(1),
  );
}
const unitShape = z.strictObject({
  id: uuid,
  high: offset,
  ranges: boundedArray(z.tuple([offset, offset]), maxRanges),
});
export const validId = (value: unknown) => uuid.safeParse(value).success;
export const pairKey = (line: Pick<PurchaseLine, "productId" | "variantId">) =>
  JSON.stringify([line.productId, line.variantId]);
const quantityShape = z.number().int().positive();
const purchaseShape = z.object({
  productId: uuid,
  variantId: uuid,
  quantity: quantityShape,
});

function validCount(units: Units, quantity: number) {
  const high = BigInt(units.high);
  let previous = -1n,
    count = 0n;
  for (const [lo, hi] of units.ranges) {
    const start = BigInt(lo),
      end = BigInt(hi);
    if (start <= previous || start >= end || end > high) return false;
    previous = end;
    count += end - start;
  }
  return count === BigInt(quantity);
}
export function decodeUnits(value: unknown, quantity: number): Units | null {
  const parsed = unitShape.safeParse(value);
  return parsed.success && validCount(parsed.data, quantity) ? parsed.data : null;
}
export function freshUnits(quantity: number): Units {
  return {
    id: crypto.randomUUID(),
    high: String(quantity),
    ranges: [["0", String(quantity)]],
  };
}
function prefix(ranges: Range[], length: bigint): Range[] {
  const selected: Range[] = [];
  for (const [lo, hi] of ranges) {
    if (length === 0n) break;
    const start = BigInt(lo),
      width = BigInt(hi) - start;
    const take = width < length ? width : length;
    selected.push([lo, String(start + take)]);
    length -= take;
  }
  return selected;
}
export function resizeUnits(units: Units, before: number, after: number): Units {
  if (before === after) return units;
  if (after < before) return { ...units, ranges: prefix(units.ranges, BigInt(after)) };
  const high = String(BigInt(units.high) + BigInt(after) - BigInt(before));
  const ranges = units.ranges.slice();
  const last = ranges.at(-1);
  if (last?.[1] === units.high) ranges[ranges.length - 1] = [last[0], high];
  else ranges.push([units.high, high]);
  return { ...units, high, ranges };
}
export function subtractPurchasedPrefix(
  live: Units,
  captured: Units,
  quantity: number,
): Units {
  if (live.id !== captured.id) return live;
  const bought = prefix(captured.ranges, BigInt(quantity));
  const kept: Range[] = [];
  let i = 0;
  for (const [lo, hi] of live.ranges) {
    let start = BigInt(lo);
    const end = BigInt(hi);
    while (i < bought.length && BigInt(bought[i][1]) <= start) i++;
    while (i < bought.length && BigInt(bought[i][0]) < end) {
      const from = BigInt(bought[i][0]),
        to = BigInt(bought[i][1]);
      if (from > start) kept.push([String(start), String(from)]);
      if (to >= end) {
        start = end;
        break;
      }
      if (to > start) start = to;
      i++;
    }
    if (start < end) kept.push([String(start), hi]);
  }
  return { ...live, ranges: kept };
}
function remainingCount(units: Units) {
  return Number(
    units.ranges.reduce((count, [lo, hi]) => count + BigInt(hi) - BigInt(lo), 0n),
  );
}

export function uniqueLines(
  lines: readonly Pick<PurchaseLine, "productId" | "variantId">[],
) {
  return new Set(lines.map(pairKey)).size === lines.length;
}
export function projection(value: unknown): PurchaseLine[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > maxLines) return;
  const result = z.array(purchaseShape).safeParse(value);
  if (result.success && uniqueLines(result.data)) return result.data;
}
export function sameProjection(a: readonly PurchaseLine[], b: readonly PurchaseLine[]) {
  if (a.length !== b.length) return false;
  const counts = new Map(a.map((line) => [pairKey(line), line.quantity]));
  return b.every((line) => counts.get(pairKey(line)) === line.quantity);
}
const capturedShape = purchaseShape
  .extend({ units: unitShape })
  .transform((line, ctx) => {
    // Transforms run only after primitive parsing succeeds, including decimal syntax.
    if (validCount(line.units, line.quantity)) return line;
    ctx.addIssue({ code: "custom", message: "Captured ranges do not match quantity" });
    return z.NEVER;
  });
type CapturedLine = z.infer<typeof capturedShape>;
const common = {
  at: z.number().int().nonnegative(),
  origin: uuid,
  attemptKey: uuid,
  captureId: uuid,
};
const purchasedShape = boundedArray(purchaseShape, maxLines).refine(uniqueLines);
const capturedLinesShape = boundedArray(capturedShape, maxLines).refine(
  (lines) =>
    uniqueLines(lines) && new Set(lines.map((l) => l.units.id)).size === lines.length,
);
const recordShape = z.discriminatedUnion("stage", [
  z.strictObject({
    ...common,
    stage: z.literal("pending"),
    orderId: uuid.optional(),
    lines: capturedLinesShape,
  }),
  z.strictObject({
    ...common,
    stage: z.literal("applying"),
    orderId: uuid,
    lines: capturedLinesShape,
    purchased: purchasedShape,
  }),
  z.strictObject({
    ...common,
    stage: z.literal("receipt"),
    orderId: uuid,
    purchased: purchasedShape,
  }),
  z.strictObject({ ...common, stage: z.literal("retired"), orderId: uuid.optional() }),
]);
export type Proof = z.infer<typeof recordShape>;
type ActiveProof = Extract<Proof, { stage: "pending" | "applying" }>;
export function subset(capture: ActiveProof, purchased: readonly PurchaseLine[]) {
  const counts = new Map(capture.lines.map((line) => [pairKey(line), line.quantity]));
  return purchased.every((line) => line.quantity <= (counts.get(pairKey(line)) ?? 0));
}
export function captureLines(rows: SavedLine[]): CapturedLine[] | undefined {
  const items = projection(rows.map((row) => row.item));
  if (!items || rows.some((row) => !row.units)) return;
  return items.map((line, i) => ({ ...line, units: rows[i].units! }));
}
export function subtractRows(
  rows: SavedLine[],
  proof: ActiveProof,
  purchased: readonly PurchaseLine[],
): SavedLine[] | undefined {
  const byId = new Map(proof.lines.map((line) => [line.units.id, line]));
  const counts = new Map(purchased.map((line) => [pairKey(line), line.quantity]));
  const kept: SavedLine[] = [];
  for (const row of rows) {
    if (!row.units) return;
    const captured = byId.get(row.units.id);
    if (
      captured &&
      (pairKey(captured) !== pairKey(row.item) ||
        BigInt(captured.units.high) > BigInt(row.units.high))
    )
      return;
    const count = counts.get(pairKey(row.item));
    if (!captured || !count) {
      kept.push(row);
      continue;
    }
    const units = subtractPurchasedPrefix(row.units, captured.units, count);
    const quantity = remainingCount(units);
    if (quantity === row.item.quantity) kept.push(row);
    else if (quantity) {
      if (units.ranges.length > maxRanges) return;
      kept.push({ item: { ...row.item, quantity }, units });
    }
  }
  return kept;
}

const witnessPrefix = "rdk-cart-v1:";
export function contextOrigin(): string | undefined {
  if (!window.name) window.name = witnessPrefix + crypto.randomUUID();
  const id = window.name.slice(witnessPrefix.length);
  if (window.name.startsWith(witnessPrefix) && validId(id)) return id;
}

function commonFields(record: Proof) {
  const { at, origin, attemptKey, captureId, orderId } = record;
  return { at, origin, attemptKey, captureId, orderId };
}
export class PurchaseProofs {
  private constructor(
    private area: Storage,
    private key: string,
    readonly records: Proof[],
    private readonly eligible: () => boolean,
  ) {}
  static empty(area: Storage, key: string, eligible: () => boolean) {
    return new PurchaseProofs(area, key, [], eligible);
  }
  static read(
    area: Storage,
    key: string,
    guestOrigin: string | undefined,
    eligible: () => boolean,
  ): PurchaseProofs | undefined {
    const raw = area.getItem(key);
    let records: Proof[] = [];
    if (raw !== null) {
      if (raw.length > maxProofCharacters) return;
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(decoded) || decoded.length > maximumRecords) return;
      const result = z.array(recordShape).safeParse(decoded);
      if (!result.success) return;
      records = result.data;
      const now = Date.now();
      if (
        records.some(
          (r) => r.at > now || (r.stage === "applying" && !subset(r, r.purchased)),
        )
      )
        return;
      const distinct = (ids: string[]) => new Set(ids).size === ids.length;
      if (
        !distinct(records.map((r) => r.captureId)) ||
        !distinct(records.map((r) => r.attemptKey)) ||
        !distinct(records.flatMap((r) => (r.orderId ? [r.orderId] : []))) ||
        !distinct(records.filter((r) => r.stage !== "retired").map((r) => r.origin))
      )
        return;
      // Expired and foreign guest records lose eligibility on read. The next proof
      // mutation persists the filtered list; a passive observation preserves bytes.
      records = records.filter(
        (r) => now - r.at < maximumAge && (!guestOrigin || r.origin === guestOrigin),
      );
    }
    return new PurchaseProofs(area, key, records, eligible);
  }
  private write(records: Proof[]) {
    const raw = JSON.stringify(records);
    if (raw.length > maxProofCharacters || !this.eligible()) return false;
    this.area.setItem(this.key, raw);
    return true;
  }
  replace(old: Proof, replacement: Proof) {
    return this.write(this.records.map((r) => (r === old ? replacement : r)));
  }
  insert(proof: ActiveProof) {
    const retained = this.records.map(
      (r): Proof =>
        r.origin === proof.origin && r.stage !== "retired"
          ? { ...commonFields(r), stage: "retired" }
          : r,
    );
    return this.write(
      [...retained, proof].sort((a, b) => a.at - b.at).slice(-maximumRecords),
    );
  }
  finish(proof: ActiveProof, orderId: string, purchased: PurchaseLine[]) {
    return this.replace(proof, {
      ...commonFields(proof),
      stage: "receipt",
      orderId,
      purchased,
    });
  }
}
