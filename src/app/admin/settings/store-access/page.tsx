"use client";

import { StoreAccessSettingsPanel } from "@/components/admin/settings/StoreAccessSettingsPanel";
import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";

export default function StoreAccessSettingsPage() {
  return (
    <AdminPage width="content">
      <AdminPageHeader
        eyebrow="Settings"
        title="Store access"
        description="Control the storefront lock screen and checkout availability."
      />

      <StoreAccessSettingsPanel />
    </AdminPage>
  );
}
