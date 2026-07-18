"use client";

import { useEffect, useState } from "react";

import { RdkSelect } from "@/components/ui/Select";
import {
  canInviteAdmins,
  isDevRole,
  isProfileRole,
  type ProfileRole,
} from "@/config/constants/roles";
import { logError } from "@/lib/utils/log";

type AdminProfile = { id: string; email: string | null; role: ProfileRole | null };

export default function AdminProfilePage() {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [message, setMessage] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "super_admin">("admin");
  const [inviteUrl, setInviteUrl] = useState("");

  useEffect(() => {
    fetch("/api/admin/profile", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setProfile(data.profile ?? null))
      .catch((error) =>
        logError(error, { layer: "frontend", event: "admin_load_profile" }),
      );
  }, []);

  const role = isProfileRole(profile?.role) ? profile.role : "customer";
  const canInvite = canInviteAdmins(role);
  const canInviteSuper = isDevRole(role);

  useEffect(() => {
    if (!canInviteSuper) {
      setInviteRole("admin");
    }
  }, [canInviteSuper]);

  const createInvite = async () => {
    setInviteUrl("");
    setMessage("");
    const response = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: inviteRole }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(data?.error ?? "Failed to create invite.");
      return;
    }
    setInviteUrl(data.inviteUrl ?? "");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-3xl font-bold text-white">Admin Profile</h1>
        <p className="text-gray-400">{profile?.email ?? "Loading account..."}</p>
      </div>

      {message && (
        <div className="border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
          {message}
        </div>
      )}

      {canInvite && (
        <section className="space-y-4 border border-zinc-800/70 bg-zinc-900 p-6">
          <div>
            <h2 className="text-xl font-semibold text-white">Invite Admins</h2>
            <p className="text-sm text-gray-400">
              Generate a single-use admin invite link.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RdkSelect
              value={inviteRole}
              onChange={(value) => setInviteRole(value as "admin" | "super_admin")}
              options={[
                { value: "admin", label: "Admin" },
                ...(canInviteSuper
                  ? [{ value: "super_admin", label: "Super Admin" }]
                  : []),
              ]}
              className="min-w-[160px]"
            />
            <button
              type="button"
              onClick={() => void createInvite()}
              className="bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Generate Link
            </button>
          </div>
          {inviteUrl && (
            <div className="space-y-2">
              <input
                readOnly
                value={inviteUrl}
                className="w-full border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
              />
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(inviteUrl)}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Copy link
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
