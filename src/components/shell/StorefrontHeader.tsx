"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { StoreOverlayNavigation } from "./StoreOverlayLink";
import { useRouter } from "next/navigation";

import { CartDrawer } from "@/components/cart/CartDrawer";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import { ScrollHeader } from "@/components/shell/ScrollHeader";
import type { ProfileRole } from "@/config/constants/roles";

type StorefrontHeaderProps = {
  isAuthenticated?: boolean;
  userEmail?: string;
  role?: ProfileRole | null;
};

function readInvoker(event: Event): HTMLElement | null {
  const invoker = event instanceof CustomEvent ? event.detail?.invoker : null;
  return invoker instanceof HTMLElement ? invoker : null;
}

export function StorefrontHeader({
  isAuthenticated = false,
  userEmail,
  role = null,
}: StorefrontHeaderProps) {
  const router = useRouter();
  const [navigationPending, startNavigation] = useTransition();
  const destination = useRef<string | null>(null);
  const [navigationLabel, setNavigationLabel] = useState("");
  function navigate(href: string, label: string) {
    destination.current = new URL(href, location.href).href;
    setNavigationLabel(label);
    startNavigation(() => router.push(href));
  }
  useEffect(() => {
    if (navigationPending || !destination.current) return;
    const focusDestination = () => {
      if (location.href !== destination.current || document.querySelector("dialog[open]"))
        return;
      destination.current = null;
      document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
    };
    focusDestination();
    document.addEventListener("close", focusDestination, true);
    return () => document.removeEventListener("close", focusDestination, true);
  }, [navigationPending, navigationLabel]);
  const [search, setSearch] = useState<{ invoker: HTMLElement | null } | null>(null);
  const [cart, setCart] = useState<{ invoker: HTMLElement | null } | null>(null);

  useEffect(() => {
    const handleOpenSearch = (event: Event) => {
      const invoker = readInvoker(event);
      setSearch((current) => current ?? { invoker });
    };
    const handleOpenCart = (event: Event) => {
      const invoker = readInvoker(event);
      setCart((current) => current ?? { invoker });
    };

    window.addEventListener("openSearch", handleOpenSearch);
    window.addEventListener("openCart", handleOpenCart);

    return () => {
      window.removeEventListener("openSearch", handleOpenSearch);
      window.removeEventListener("openCart", handleOpenCart);
    };
  }, []);

  return (
    <StoreOverlayNavigation.Provider value={navigate}>
      <ScrollHeader isAuthenticated={isAuthenticated} userEmail={userEmail} role={role} />
      {navigationPending && (
        <p
          role="status"
          className="fixed inset-x-0 top-[var(--rdk-visible-header-height,0px)] z-40 border-b border-zinc-200 bg-white px-5 py-2 text-center text-sm text-zinc-700"
        >
          {navigationLabel}
        </p>
      )}
      <SearchOverlay
        onSearch={(href) => navigate(href, "Loading search results…")}
        isOpen={search !== null}
        invoker={search?.invoker}
        onClose={() => setSearch(null)}
      />
      <CartDrawer
        isOpen={cart !== null}
        invoker={cart?.invoker}
        onClose={() => setCart(null)}
      />
    </StoreOverlayNavigation.Provider>
  );
}
