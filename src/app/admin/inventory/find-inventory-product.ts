import { withRequestDeadline } from "@/lib/http/request-deadline";
import { readJsonResponse } from "@/lib/http/read-json-response";
import {
  type InventoryIdentity,
  inventoryLookupResponseSchema,
} from "@/lib/validation/product";

export function findInventoryProduct(identity: InventoryIdentity) {
  return withRequestDeadline(async (signal) => {
    const query = new URLSearchParams(identity);
    const result = await readJsonResponse<unknown>(
      await fetch("/api/admin/products?" + query, { signal }),
      "Unable to check inventory.",
    );
    const parsed = inventoryLookupResponseSchema.safeParse(result);
    if (!parsed.success) throw new Error("Inventory result is incomplete.");
    const { product } = parsed.data;
    if (
      product &&
      ("exactId" in identity
        ? product.id !== identity.exactId
        : !product.variants.some((variant) => variant.sku === identity.exactSku))
    ) {
      throw new Error("Inventory result does not match the request.");
    }
    return product;
  });
}
