"use client";

import { useEffect, useRef, useState } from "react";

import { useCart } from "@/components/cart/CartProvider";
import type { ProfileRole } from "@/config/constants/roles";

import { Navbar } from "./Navbar";

interface ScrollHeaderProps {
  isAuthenticated?: boolean;
  userEmail?: string;
  role?: ProfileRole | null;
}

type HeaderStage = 0 | 1 | 2;

const WHEEL_THRESHOLD = 28;
const TOUCH_THRESHOLD = 36;
const HEADER_TRANSITION = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";
const TOP_TOLERANCE = 1;
const ANNOUNCEMENT_REVEAL_ZONE = 56;

export function ScrollHeader({
  isAuthenticated = false,
  userEmail,
  role = null,
}: ScrollHeaderProps) {
  const { itemCount } = useCart();
  const headerRef = useRef<HTMLElement | null>(null);
  const [showAnnouncement, setShowAnnouncement] = useState(true);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }

    const root = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stageRef = {
      current: window.scrollY <= TOP_TOLERANCE ? (2 as HeaderStage) : (1 as HeaderStage),
    };
    let maxHeaderHeight = header.offsetHeight;
    let lastTouchY: number | null = null;

    const getNavbarHeight = () => {
      const navbar = header.querySelector<HTMLElement>("[data-navbar-shell]");
      return navbar?.offsetHeight ?? header.offsetHeight;
    };

    const getAnnouncementHeight = () => {
      const announcement = header.querySelector<HTMLElement>("[data-announcement-shell]");
      return announcement?.scrollHeight ?? 0;
    };

    const getHeaderHeightForStage = (stage: HeaderStage) => {
      return getNavbarHeight() + (stage === 2 ? getAnnouncementHeight() : 0);
    };

    const syncReservedHeight = () => {
      maxHeaderHeight = Math.max(maxHeaderHeight, getHeaderHeightForStage(2));
      root.style.setProperty("--rdk-header-height", `${maxHeaderHeight}px`);
    };

    const applyStage = (stage: HeaderStage, animate: boolean) => {
      stageRef.current = stage;
      const announcementVisible = stage === 2;
      const navbarHeight = getNavbarHeight();
      const headerHeight = getHeaderHeightForStage(stage);
      const hiddenPixels = stage === 0 ? navbarHeight : 0;
      const visibleHeight = Math.max(0, headerHeight - hiddenPixels);

      setShowAnnouncement(announcementVisible);
      syncReservedHeight();
      header.style.transition =
        animate && !reducedMotion.matches ? HEADER_TRANSITION : "none";
      header.style.transform = `translate3d(0, -${hiddenPixels}px, 0)`;
      root.style.setProperty("--rdk-header-offset", `${visibleHeight}px`);
      root.style.setProperty("--rdk-visible-header-height", `${visibleHeight}px`);
    };

    const advanceStage = (direction: "up" | "down") => {
      const currentScrollY = Math.max(0, window.scrollY);
      const stage = stageRef.current;

      if (direction === "down") {
        if (stage === 2) {
          applyStage(1, true);
          return;
        }

        if (stage === 1 && currentScrollY > getNavbarHeight()) {
          applyStage(0, true);
        }
        return;
      }

      if (stage === 0) {
        applyStage(1, true);
        return;
      }

      if (stage === 1 && currentScrollY <= ANNOUNCEMENT_REVEAL_ZONE) {
        applyStage(2, true);
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < WHEEL_THRESHOLD) {
        return;
      }

      advanceStage(event.deltaY > 0 ? "down" : "up");
    };

    const handleTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null;
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const endY = event.changedTouches[0]?.clientY;
      if (lastTouchY == null || typeof endY !== "number") {
        lastTouchY = null;
        return;
      }

      const deltaY = lastTouchY - endY;
      lastTouchY = null;

      if (Math.abs(deltaY) < TOUCH_THRESHOLD) {
        return;
      }

      advanceStage(deltaY > 0 ? "down" : "up");
    };

    const handleScroll = () => {
      if (window.scrollY <= TOP_TOLERANCE && stageRef.current !== 2) {
        applyStage(2, false);
      }
    };

    const handleResize = () => {
      syncReservedHeight();
      applyStage(stageRef.current, false);
    };

    const resizeObserver = new ResizeObserver(() => {
      syncReservedHeight();
      applyStage(stageRef.current, false);
    });

    resizeObserver.observe(header);
    applyStage(stageRef.current, false);
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      root.style.removeProperty("--rdk-header-height");
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
        showAnnouncement={showAnnouncement}
      />
    </header>
  );
}
