// src/components/shell/ScrollHeader.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useCart } from "@/components/cart/CartProvider";
import type { ProfileRole } from "@/config/constants/roles";

import { Navbar } from "./Navbar";

interface ScrollHeaderProps {
  isAuthenticated?: boolean;
  userEmail?: string;
  role?: ProfileRole | null;
}

export function ScrollHeader({
  isAuthenticated = false,
  userEmail,
  role = null,
}: ScrollHeaderProps) {
  const { itemCount } = useCart();

  // ✅ Hooks must be unconditional
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  const headerRef = useRef<HTMLElement | null>(null);

  const updateHeaderOffset = useCallback(() => {
    const headerHeight = headerRef.current?.offsetHeight ?? 0;
    const baseGap = 0;
    const offset = isVisible ? headerHeight + baseGap : baseGap;
    document.documentElement.style.setProperty("--rdk-header-offset", `${offset}px`);
  }, [isVisible]);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const last = lastScrollYRef.current;

      if (currentScrollY < 10) {
        setIsVisible(true);
      } else if (currentScrollY > last) {
        setIsVisible(false);
      } else {
        setIsVisible(true);
      }

      lastScrollYRef.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    updateHeaderOffset();
    window.addEventListener("resize", updateHeaderOffset);
    return () => window.removeEventListener("resize", updateHeaderOffset);
  }, [updateHeaderOffset]);

  return (
    <header
      ref={headerRef}
      className={`fixed top-0 left-0 right-0 z-50 bg-white transition-transform duration-300 ease-out ${
        isVisible ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <Navbar
        isAuthenticated={isAuthenticated}
        userEmail={userEmail}
        role={role}
        cartCount={itemCount}
      />
    </header>
  );
}
