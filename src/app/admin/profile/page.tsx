"use client";

import { useEffect, useState } from "react";

import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";
import { logError } from "@/lib/utils/log";

type AdminProfile = { email: string | null };

export default function AdminProfilePage() {
  const [profile, setProfile] = useState<AdminProfile | null>(null);

  useEffect(() => {
    fetch("/api/admin/profile", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setProfile(data.profile ?? null))
      .catch((error) =>
        logError(error, { layer: "frontend", event: "admin_load_profile" }),
      );
  }, []);

  return (
    <AdminPage width="narrow">
      <AdminPageHeader
        eyebrow="Account"
        title="Admin profile"
        description={profile?.email ?? "Loading account..."}
      />
    </AdminPage>
  );
}
