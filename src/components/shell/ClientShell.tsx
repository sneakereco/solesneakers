"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { Footer } from "@/components/shell/Footer";
import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
import { StorefrontHeader } from "@/components/shell/StorefrontHeader";
import type { ProfileRole } from "@/config/constants/roles";

export function ClientShell({
  children,
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

  return (
    <>
      <div className="min-h-screen bg-[var(--storefront-surface)] text-black">
        <StorefrontHeader
          isAuthenticated={isAuthenticated}
          userEmail={userEmail ?? undefined}
          role={role}
        />
        <main
          className="min-h-screen bg-[var(--storefront-surface)] pb-20 text-black md:pb-0"
          style={{ paddingTop: "var(--rdk-header-height, 5rem)" }}
        >
          {children}
        </main>
      </div>
      <Footer />
      <MobileBottomNav />
    </>
  );
}
