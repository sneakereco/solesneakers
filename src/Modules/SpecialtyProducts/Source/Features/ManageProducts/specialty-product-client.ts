import type { SpecialtyProductWrite } from "./specialty-product-contract";
export async function saveSpecialtyProduct(input: SpecialtyProductWrite): Promise<void> {
  const response = await fetch(
    input.mode === "create"
      ? "/api/admin/specialty/products"
      : "/api/admin/specialty/products/" + input.productId,
    {
      method: input.mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.error ?? "The specialty product could not be saved.");
}
