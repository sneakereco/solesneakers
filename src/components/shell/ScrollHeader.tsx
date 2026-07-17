"use client";

import { useEffect, useRef } from "react";

import { useCart } from "@/components/cart/CartProvider";
import type { ProfileRole } from "@/config/constants/roles";

import { Navbar } from "./Navbar";

interface ScrollHeaderProps {
  isAuthenticated?: boolean;
  userEmail?: string;
  role?: ProfileRole | null;
}

const DIRECTION_THRESHOLD = 12;
const HEADER_TRANSITION = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";

export function ScrollHeader({
  isAuthenticated = false,
  userEmail,
  role = null,
}: ScrollHeaderProps) {
  const { itemCount } = useCart();
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }

    const root = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let headerHeight = header.offsetHeight;
    let lastScrollY = window.scrollY;
    let direction: "up" | "down" | null = null;
    let directionTravel = 0;
    let hasClearedHeader = lastScrollY >= headerHeight;
    let floatingVisible = false;
    let animationFrame = 0;

    const applyPosition = (hiddenPixels: number, animate: boolean) => {
      const clampedHiddenPixels = Math.min(headerHeight, Math.max(0, hiddenPixels));
      const visibleHeight = Math.max(0, headerHeight - clampedHiddenPixels);

      header.style.transition =
        animate && !reducedMotion.matches ? HEADER_TRANSITION : "none";
      header.style.transform = `translate3d(0, -${clampedHiddenPixels}px, 0)`;
      root.style.setProperty("--rdk-header-offset", `${visibleHeight}px`);
      root.style.setProperty("--rdk-visible-header-height", `${visibleHeight}px`);
    };

    const update = () => {
      animationFrame = 0;
      const currentScrollY = Math.max(0, window.scrollY);
      const delta = currentScrollY - lastScrollY;
      const nextDirection = delta > 0 ? "down" : delta < 0 ? "up" : direction;

      if (nextDirection && nextDirection !== direction) {
        direction = nextDirection;
        directionTravel = 0;
      }
      directionTravel += Math.abs(delta);

      if (!hasClearedHeader && currentScrollY < headerHeight) {
        // Before the header has naturally left the viewport, move it exactly
        // with the page instead of invoking floating-header behavior.
        applyPosition(currentScrollY, false);
      } else {
        if (!hasClearedHeader) {
          hasClearedHeader = true;
          floatingVisible = false;
        }

        if (currentScrollY > headerHeight) {
          if (directionTravel >= DIRECTION_THRESHOLD && direction === "up") {
            floatingVisible = true;
            directionTravel = 0;
          } else if (directionTravel >= DIRECTION_THRESHOLD && direction === "down") {
            floatingVisible = false;
            directionTravel = 0;
          }

          applyPosition(floatingVisible ? 0 : headerHeight, true);
        } else if (floatingVisible) {
          // A revealed floating header remains stable while returning to the top.
          applyPosition(0, true);
        } else {
          // If it stayed hidden, let it re-enter with its original document slot.
          applyPosition(currentScrollY, false);
        }
      }

      if (currentScrollY <= 1) {
        hasClearedHeader = false;
        floatingVisible = false;
        direction = null;
        directionTravel = 0;
        applyPosition(0, false);
      }

      lastScrollY = currentScrollY;
    };

    const scheduleUpdate = () => {
      if (!animationFrame) {
        animationFrame = window.requestAnimationFrame(update);
      }
    };

    const handleResize = () => {
      headerHeight = header.offsetHeight;
      scheduleUpdate();
    };

    applyPosition(
      hasClearedHeader ? headerHeight : Math.min(lastScrollY, headerHeight),
      false,
    );
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", handleResize);
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      root.style.removeProperty("--rdk-header-offset");
      root.style.removeProperty("--rdk-visible-header-height");
    };
  }, []);

  return (
    <header
      ref={headerRef}
      data-storefront-header
      className="fixed inset-x-0 top-0 z-50 will-change-transform"
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
