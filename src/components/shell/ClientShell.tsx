"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Footer } from "@/components/shell/Footer";
import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
import { StorefrontHeader } from "@/components/shell/StorefrontHeader";
import type { ProfileRole } from "@/config/constants/roles";

export function ClientShell({
  children,
  isAdmin = false,
  isAuthenticated = false,
  userEmail = null,
  role = null,
}: {
  children: React.ReactNode;
  isAdmin?: boolean;
  isAuthenticated?: boolean;
  userEmail?: string | null;
  role?: ProfileRole | null;
}) {
  const pathname = usePathname();

  useEffect(() => {
    document.body.dataset.route = "store";
    return () => {
      delete document.body.dataset.route;
    };
  }, [pathname]);

  const showAdminSidebar = isAdmin && Boolean(role);

  return (
    <>
      {showAdminSidebar && (
        <AdminSidebar userEmail={userEmail} role={role as ProfileRole} />
      )}
      <div
        className={`${showAdminSidebar ? "md:ml-64" : ""} min-h-screen bg-[var(--storefront-surface)] text-black`.trim()}
      >
        <StorefrontHeader
          isAuthenticated={isAuthenticated}
          userEmail={userEmail ?? undefined}
          role={role}
        />
        <main className="min-h-screen bg-[var(--storefront-surface)] pt-28 pb-20 text-black sm:pt-32 md:pb-0">
          {children}
        </main>
      </div>
      <Footer />
      <MobileBottomNav />
    </>
  );
}
