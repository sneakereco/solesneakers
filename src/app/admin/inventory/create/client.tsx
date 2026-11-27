// app/admin/inventory/create/client.tsx
"use client";
import { adminCommand } from "@/components/admin/admin-command";

import { useState } from "react";
import { findInventoryProduct } from "../find-inventory-product";
import { useRouter } from "next/navigation";

import { ProductForm } from "@/components/inventory/ProductForm";
import type { ProductCreateInput } from "@/services/product-service";
import { saveSpecialtyProduct } from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/specialty-product-client";

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
    const skus = unconfirmed.variants.map((variant) => variant.sku);
    const firstSku = skus[0];
    if (!firstSku || skus.some((sku) => !sku))
      throw new Error("Review the submitted product in inventory.");
    const match = await findInventoryProduct({ exactSku: firstSku });
    if (
      !match ||
      match.name !== unconfirmed.name ||
      match.variants.length !== skus.length ||
      !skus.every((sku) => match.variants.some((variant) => variant.sku === sku))
    )
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
      onSpecialtySubmit={async (input) => {
        await saveSpecialtyProduct(input);
        router.push("/admin/inventory");
        router.refresh();
      }}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      initialBrands={initialBrands}
      initialSizes={initialSizes}
    />
  );
}
