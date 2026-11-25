// app/admin/inventory/create/client.tsx
"use client";

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

  const handleSubmit = async (data: ProductCreateInput) => {
    const response = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      router.push("/admin/inventory");
    } else {
      let message = "Failed to create product";
      try {
        const payload = await response.json();
        if (payload?.error) {
          message = payload.error;
        }
      } catch {
        // ignore parse errors
      }
      throw new Error(message);
    }
  };

  const handleCancel = () => {
    router.push("/admin/inventory");
  };

  return (
    <ProductForm
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
