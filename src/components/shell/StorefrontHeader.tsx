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

export function StorefrontHeader({
  isAuthenticated = false,
  userEmail,
  role = null,
}: StorefrontHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    const handleOpenSearch = () => setSearchOpen(true);
    const handleOpenCart = () => setCartOpen(true);

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
      <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
      <CartDrawer isOpen={cartOpen} onClose={() => setCartOpen(false)} />
    </>
  );
}
