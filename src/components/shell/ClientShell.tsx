"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { Footer } from "@/components/shell/Footer";
import { StorefrontHeader } from "@/components/shell/StorefrontHeader";
import type { ProfileRole } from "@/config/constants/roles";
import { captureStorefrontViewed } from "@/lib/measurement/client";
import { enteredStorefront } from "@/lib/measurement/triggers";

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
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    if (enteredStorefront(previousPathname.current, pathname)) {
      captureStorefrontViewed();
    }
    previousPathname.current = pathname;
  }, [pathname]);

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
          className="min-h-screen bg-[var(--storefront-surface)] text-black"
          style={{ paddingTop: "var(--rdk-header-height, 5rem)" }}
        >
          {children}
        </main>
      </div>
      <Footer />
    </>
  );
}
