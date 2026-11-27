"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { Footer } from "@/components/shell/Footer";
import { StorefrontHeader } from "@/components/shell/StorefrontHeader";
import { captureStorefrontViewed } from "@/lib/measurement/client";
import { enteredStorefront } from "@/lib/measurement/triggers";

export function ClientShell({ children }: { children: React.ReactNode }) {
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
        <StorefrontHeader />
        <main
          tabIndex={-1}
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
