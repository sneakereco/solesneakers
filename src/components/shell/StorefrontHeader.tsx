"use client";

import { useEffect, useState } from "react";

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
    <>
      <ScrollHeader isAuthenticated={isAuthenticated} userEmail={userEmail} role={role} />
      <SearchOverlay
        isOpen={search !== null}
        invoker={search?.invoker}
        onClose={() => setSearch(null)}
      />
      <CartDrawer
        isOpen={cart !== null}
        invoker={cart?.invoker}
        onClose={() => setCart(null)}
      />
    </>
  );
}
