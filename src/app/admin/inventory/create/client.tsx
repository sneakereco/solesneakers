// app/admin/inventory/create/client.tsx
"use client";
import { adminCommand } from "@/components/admin/admin-command";

import { useState } from "react";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { useRouter } from "next/navigation";

import { ProductForm } from "@/components/inventory/ProductForm";
import type { ProductCreateInput } from "@/services/product-service";

interface CreateProductClientProps {
  initialBrands: Array<{
    id: string;
    label: string;
  }>;
  initialSizes: Array<{ id: string; label: string; sizeType: string }>;
}

export function CreateProductClient({
  initialBrands,
  initialSizes,
}: CreateProductClientProps) {
  const router = useRouter();
  const [unconfirmed, setUnconfirmed] = useState<ProductCreateInput | null>(null);
  const checkProduct = async () => {
    if (!unconfirmed) return;
    const sku = unconfirmed.variants[0]?.sku;
    if (!sku)
      throw new Error("Check inventory for the new product before creating it again.");
    const query = new URLSearchParams({
      q: sku,
      stockStatus: "all",
      includeOutOfStock: "1",
      searchMode: "inventory",
    });
    const { products } = await fetchJsonWithDeadline<{
      products: { id: string; name: string; variants: { sku: string }[] }[];
    }>(
      `/api/admin/products?${query}`,
      "Inventory unavailable. Check again.",
      new AbortController().signal,
    );
    const match = products.find(
      (product) =>
        product.name === unconfirmed.name &&
        unconfirmed.variants.every((v) =>
          product.variants.some((saved) => saved.sku === v.sku),
        ),
    );
    if (!match)
      throw new Error(
        "Product creation is still unconfirmed. Check inventory again before creating another product.",
      );
    router.push(`/admin/inventory/${match.id}/edit`);
  };

  const handleSubmit = async (data: ProductCreateInput) => {
    if (unconfirmed) return checkProduct();
    const reply = await (async () => {
      try {
        return await adminCommand<{ error?: string; id?: string }>(
          "/api/admin/products",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
        );
      } catch {
        return null;
      }
    })();
    if (
      !reply ||
      reply.response.status >= 500 ||
      (reply.response.ok && !reply.data?.id)
    ) {
      setUnconfirmed(data);
      throw new Error(
        "Product creation is unconfirmed. Check inventory before creating another product.",
      );
    }
    const { response, data: result } = reply;
    if (response.ok) {
      router.push("/admin/inventory");
    } else {
      throw new Error(result?.error ?? "Failed to create product");
    }
  };

  const handleCancel = () => {
    router.push("/admin/inventory");
  };

  return (
    <ProductForm
      onCheckSave={unconfirmed ? checkProduct : undefined}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      initialBrands={initialBrands}
      initialSizes={initialSizes}
    />
  );
}
