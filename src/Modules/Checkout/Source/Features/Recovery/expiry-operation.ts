export type ExpiryResult = "released" | "reconcile" | "review" | "unchanged";
export type ExpiryMark =
  | { kind: "unchanged" | "review" }
  | { kind: "inquire"; squareOrderId: string | null; unknownKeys: string[] };
type Dependencies = {
  mark(id: string): Promise<ExpiryMark>;
  inquire(id: string): Promise<unknown>;
  cancelByKey(key: string): Promise<void>;
  cancelOrder(id: string, orderId: string): Promise<string | null>;
  finish(orderId: string, confirmedSquareOrderId: string | null): Promise<ExpiryResult>;
};
export async function expireCheckout(
  orderId: string,
  deps: Dependencies,
): Promise<ExpiryResult> {
  const mark = await deps.mark(orderId);
  if (mark.kind !== "inquire") return mark.kind;
  if (mark.squareOrderId) {
    await deps.inquire(orderId);
    for (const key of mark.unknownKeys) await deps.cancelByKey(key);
    const confirmed = await deps.cancelOrder(mark.squareOrderId, orderId);
    return deps.finish(orderId, confirmed);
  }
  return deps.finish(orderId, null);
}
