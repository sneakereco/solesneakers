// app/admin/inventory/create/page.tsx (SERVER-SIDE VERSION)

import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";

import { getFormInitialData } from "./actions";
import { CreateProductClient } from "./client";

export default async function CreateProductPage() {
  // SERVER-SIDE: Load data before rendering
  const initialData = await getFormInitialData();

  return (
    <AdminPage width="content">
      <AdminPageHeader
        eyebrow="Catalog"
        title="Create product"
        description="Add a new product, its variants, images, and shipping details."
        backHref="/admin/inventory"
        backLabel="Inventory"
      />

      <CreateProductClient
        initialShippingDefaults={initialData.shippingDefaults}
        initialBrands={initialData.brands}
        initialSizes={initialData.sizes}
      />
    </AdminPage>
  );
}
