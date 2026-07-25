// app/admin/featured-items/page.tsx
import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";

import { FeaturedItemsManager } from "./client";

export default function FeaturedItemsPage() {
  return (
    <AdminPage width="content">
      <AdminPageHeader
        eyebrow="Merchandising"
        title="Featured items"
        description="Choose and arrange the products highlighted on the storefront."
      />
      <FeaturedItemsManager />
    </AdminPage>
  );
}
