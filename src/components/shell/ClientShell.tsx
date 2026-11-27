"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { Footer } from "@/components/shell/Footer";
import { StorefrontHeader } from "@/components/shell/StorefrontHeader";
import {
  captureStorefrontViewed,
  enteredStorefront,
} from "@/Modules/Analytics/Source/Features/VisitorMeasurement/triggers";
import { useViewGrant } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/view-grant";

export function ClientShell({ children }: { children: React.ReactNode }) {
  const grant = useViewGrant();
  const pathname = usePathname();
  const previousPathname = useRef<string | null>(null);
  const lastGrant = useRef<string | null>(null);

  useEffect(() => {
    if (!grant) {
      if (pathname !== "/store") previousPathname.current = pathname;
      return;
    }
    if (
      enteredStorefront(
        lastGrant.current === grant ? previousPathname.current : null,
        pathname,
      )
    ) {
      captureStorefrontViewed();
    }
    previousPathname.current = pathname;
    lastGrant.current = grant;
  }, [grant, pathname]);

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
