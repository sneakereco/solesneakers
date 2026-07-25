// app/admin/inventory/[id]/edit/page.tsx

import { notFound } from "next/navigation";

import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";

import { getEditFormInitialData } from "./actions";
import { EditProductClient } from "./client";

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage(props: EditProductPageProps) {
  // Await the params prop first, then destructure
  const params = await props.params;
  const { id } = params;

  // SERVER-SIDE: Load all data before rendering
  const initialData = await getEditFormInitialData(id);

  // If product not found, show 404
  if (!initialData.product) {
    notFound();
  }

  return (
    <AdminPage width="content">
      <AdminPageHeader
        eyebrow="Catalog"
        title="Edit product"
        description="Update product details, variants, media, and availability."
        backHref="/admin/inventory"
        backLabel="Inventory"
      />

      <EditProductClient
        productId={id}
        product={initialData.product}
        isArchived={Boolean(initialData.product.archived_at)}
        initialShippingDefaults={initialData.shippingDefaults}
        initialBrands={initialData.brands}
        initialModels={initialData.models}
        initialSizes={initialData.sizes}
      />
    </AdminPage>
  );
}
