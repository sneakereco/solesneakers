"use client";

import { useAdminRead } from "@/components/admin/useAdminRead";
import { AdminReadStatus } from "@/components/admin/AdminSkeletons";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";

import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";

type AdminProfile = { email: string | null };

const loadProfile = (signal: AbortSignal) =>
  fetchJsonWithDeadline<{ profile: AdminProfile }>(
    "/api/admin/profile",
    "Profile unavailable",
    signal,
  );
export default function AdminProfilePage() {
  const read = useAdminRead(loadProfile, "admin profile");
  return (
    <AdminPage width="narrow">
      <AdminPageHeader
        eyebrow="Account"
        title="Admin profile"
        description={
          read.data ? (read.data.profile?.email ?? "No email on file.") : undefined
        }
      />
      <AdminReadStatus read={read} label="Loading profile" shape="detail" />
    </AdminPage>
  );
}
