import { withRequestDeadline } from "@/lib/http/request-deadline";
import { readJsonResponse } from "@/lib/http/read-json-response";

type InventoryRecord = {
  id: string;
  name: string;
  archived_at?: string | null;
  variants: { sku: string }[];
};
/** The admin inventory endpoint searches product names. Compare identity within every matching page. */
export function findInventoryProduct(
  name: string,
  matches: (product: InventoryRecord) => boolean,
  stockStatus: "all" | "archived" = "all",
) {
  return withRequestDeadline(async (signal) => {
    const limit = 100;
    const query = new URLSearchParams({
      q: name,
      stockStatus,
      includeOutOfStock: "1",
      searchMode: "inventory",
      limit: String(limit),
    });
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      query.set("page", String(page));
      const result = await readJsonResponse<{
        products: InventoryRecord[];
        total: number;
      }>(
        await fetch("/api/admin/products?" + query, { signal }),
        "Unable to check inventory.",
      );
      if (
        !Array.isArray(result.products) ||
        !Number.isInteger(result.total) ||
        result.total < 0
      )
        throw new Error("Inventory result is incomplete.");
      if (page === 1) pages = Math.ceil(result.total / limit);
      const match = result.products.find(matches);
      if (match) return match;
    }
    return null;
  });
}
