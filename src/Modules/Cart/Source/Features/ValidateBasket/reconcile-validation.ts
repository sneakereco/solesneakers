import type { BasketLine, PurchaseLine } from "../../Contracts/Basket";
import {
  basketImage,
  catalogFacts,
  legacyReply,
  v2Reply,
  type Shortage,
  type CartValidationV2,
} from "./validation-contract";
import type { z } from "zod";
const key = (r: Pick<PurchaseLine, "productId" | "variantId">) =>
  JSON.stringify([r.productId, r.variantId]);
type Result = { kind: "apply"; items: BasketLine[] } | { kind: "ignore"; reason: string };
const ignore: Result = { kind: "ignore", reason: "Invalid cart validation response" };
export function reconcileValidation(
  snapshot: readonly BasketLine[],
  response: unknown,
): Result {
  if (!response || typeof response !== "object") return ignore;
  const versioned = "contractVersion" in response || "lineState" in response;
  const parsed = versioned
    ? v2Reply.safeParse(response)
    : legacyReply.safeParse(response);
  if (!parsed.success) return ignore;
  const requested = new Map(snapshot.map((r) => [key(r), r]));
  const accepted = new Map(parsed.data.items.map((r) => [key(r), r]));
  const removed = new Set(parsed.data.removed.map(key));
  if (
    requested.size !== snapshot.length ||
    accepted.size !== parsed.data.items.length ||
    removed.size !== parsed.data.removed.length ||
    accepted.size + removed.size !== snapshot.length
  )
    return ignore;
  const allStates =
    "lineState" in parsed.data ? (parsed.data as CartValidationV2).lineState : undefined;
  const states = new Map(allStates?.map((s) => [key(s), s]));
  if (allStates && (states.size !== snapshot.length || allStates.length !== states.size))
    return ignore;
  const items: BasketLine[] = [];
  for (const old of snapshot) {
    const id = key(old),
      line = accepted.get(id),
      state = states.get(id);
    if (
      !!line === removed.has(id) ||
      (line && line.quantity !== Math.min(old.quantity, line.maxStock))
    )
      return ignore;
    if (allStates && (!state || state.requestedQuantity !== old.quantity)) return ignore;
    if (
      state &&
      !state.orderScoped &&
      (line ? line.maxStock !== state.availableQuantity : state.availableQuantity !== 0)
    )
      return ignore;
    if (
      state &&
      ((state.availability === "available" &&
        !line &&
        !(state.orderScoped && state.facts)) ||
        (state.facts && line && !sameFacts(state.facts, line)))
    )
      return ignore;
    const maxStock = state?.availableQuantity ?? line?.maxStock ?? 0;
    const status =
      state?.availability ??
      (line && maxStock >= old.quantity ? "available" : "unavailable");
    const facts = state?.facts ?? line ?? old;
    const item: BasketLine = {
      productId: old.productId,
      variantId: old.variantId,
      quantity: old.quantity,
      maxStock,
      ...catalogFacts.parse(facts),
      imageUrl: basketImage(facts.imageUrl),
    };
    if (state?.orderScoped || old.orderScoped) item.orderScoped = true;
    if (status !== "available") item.availability = status;
    const previous = old.previousPriceCents ?? old.priceCents;
    if (old.previousPriceCents !== undefined || previous !== item.priceCents)
      item.previousPriceCents = previous;
    // Retain an unchanged observed row so a focus check does not advance its revision.
    const fields = Object.keys({ ...old, ...item }) as (keyof BasketLine)[];
    items.push(fields.every((field) => old[field] === item[field]) ? old : item);
  }
  return { kind: "apply", items };
}
function sameFacts(a: z.infer<typeof catalogFacts>, b: z.infer<typeof catalogFacts>) {
  return (
    a.priceCents === b.priceCents &&
    a.sizeLabel === b.sizeLabel &&
    a.titleDisplay === b.titleDisplay &&
    a.name === b.name &&
    a.brand === b.brand &&
    basketImage(a.imageUrl) === basketImage(b.imageUrl)
  );
}
export function lineUnavailableMessage(item: BasketLine) {
  return item.maxStock && item.maxStock < item.quantity
    ? `Only ${item.maxStock} of ${item.titleDisplay}, size ${item.sizeLabel}, available. Review the quantity.`
    : `${item.titleDisplay}, size ${item.sizeLabel}, is no longer available.`;
}
export function provenConflictMessage(
  item: BasketLine,
  reason: Shortage,
  available: number,
) {
  const text =
    reason === "reserved_by_other" && available === 0 && item.quantity === 1
      ? `Someone else just reserved the last pair of ${item.titleDisplay}, size ${item.sizeLabel}.`
      : lineUnavailableMessage({ ...item, maxStock: available });
  return text + " You haven't been charged.";
}
