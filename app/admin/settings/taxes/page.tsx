// app/admin/settings/taxes/page.tsx
"use client";

import { TaxSettingsPanel } from "@/components/admin/settings/TaxSettingsPanel";
import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";

export default function TaxSettingsPage() {
  return (
    <AdminPage width="content">
      <AdminPageHeader
        eyebrow="Settings"
        title="Tax settings"
        description="Manage tax collection and tax codes for your catalog."
      />

      <TaxSettingsPanel />
    </AdminPage>
  );
}
