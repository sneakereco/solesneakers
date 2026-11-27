import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { OrderStatusResponse } from "@/types/domain/checkout";
import { z } from "zod";
type PurchasedLine = NonNullable<OrderStatusResponse["purchasedLines"]>[number];

const rowSchema = z.object({
  id: z.uuid(),
  order_id: z.uuid(),
  product_id: z.uuid(),
  variant_id: z.uuid(),
  quantity: z.number().int().positive(),
});

export async function readPurchasedLines(
  {
    orderId,
    authorizedAccess,
  }: {
    orderId: string;
    authorizedAccess: {
      orderId: string;
      status: string;
      financialReview: boolean;
    } | null;
  },
  client: TypedSupabaseClient,
): Promise<readonly PurchasedLine[] | null> {
  try {
    if (
      !z.uuid().safeParse(orderId).success ||
      authorizedAccess?.orderId !== orderId ||
      authorizedAccess.financialReview ||
      !["paid", "shipped"].includes(authorizedAccess.status)
    )
      return null;
    const { data, count, error } = await client
      .from("order_items")
      .select("id, order_id, product_id, variant_id, quantity", { count: "exact" })
      .eq("order_id", orderId);
    if (error || !Array.isArray(data) || !count || data.length !== count) return null;
    const pairs = new Set<string>();
    const ids = new Set<string>();
    const result: PurchasedLine[] = [];
    for (const raw of data) {
      const row = rowSchema.safeParse(raw);
      if (!row.success || row.data.order_id !== orderId) return null;
      const { id, product_id: productId, variant_id: variantId, quantity } = row.data;
      const pair = productId + "/" + variantId;
      if (ids.has(id) || pairs.has(pair)) return null;
      ids.add(id);
      pairs.add(pair);
      result.push({ productId, variantId, quantity });
    }
    return result;
  } catch {
    // The receipt is still available when its purchase evidence cannot be read.
    return null;
  }
}
