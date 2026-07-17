// src/components/shell/ClientShell.tsx
"use client";

import { Suspense, useCallback, useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { ChatDrawer } from "@/components/chat/ChatDrawer";
import { Footer } from "@/components/shell/Footer";
import { MobileBottomNav } from "@/components/shell/MobileBottomNav";
import { StorefrontHeader } from "@/components/shell/StorefrontHeader";
import type { ProfileRole } from "@/config/constants/roles";

export function ClientShell({
  children,
  isAdmin = false,
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
  const [chatOpen, setChatOpen] = useState(false);
  const openChat = useCallback(() => setChatOpen(true), []);

  useEffect(() => {
    const handleOpenChat = () => setChatOpen(true);

    window.addEventListener("openChat", handleOpenChat);

    return () => {
      window.removeEventListener("openChat", handleOpenChat);
    };
  }, []);

  useEffect(() => {
    document.body.dataset.route = "store";

    return () => {
      delete document.body.dataset.route;
    };
  }, [pathname]);

  useEffect(() => {
    if (!pathname) {
      return;
    }

    const visitorKey = "rdk_visitor_id";
    const sessionKey = "rdk_session_id";
    const lastTrackedKey = "rdk_last_tracked_path";

    const getOrCreateId = (storage: Storage, key: string) => {
      const existing = storage.getItem(key);
      if (existing) {
        return existing;
      }
      const nextId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      storage.setItem(key, nextId);
      return nextId;
    };

    const visitorId = getOrCreateId(localStorage, visitorKey);
    const sessionId = getOrCreateId(sessionStorage, sessionKey);

    // OPTIMIZATION: Only track if pathname actually changed (ignore query params for deduplication)
    const lastTracked = sessionStorage.getItem(lastTrackedKey);
    if (lastTracked === pathname) {
      return; // Already tracked this pathname in this session
    }
    sessionStorage.setItem(lastTrackedKey, pathname);

    const path = `${window.location.pathname}${window.location.search}`;

    const payload = JSON.stringify({
      path,
      referrer: document.referrer || null,
      visitorId,
      sessionId,
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/analytics/track", blob);
    } else {
      fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    }
  }, [pathname]); // ✅ OPTIMIZATION: Removed searchParams - only track pathname changes

  const showAdminSidebar = isAdmin && Boolean(role);

  return (
    <>
      {showAdminSidebar && (
        <AdminSidebar userEmail={userEmail} role={role as ProfileRole} />
      )}
      <div
        className={`${showAdminSidebar ? "md:ml-64" : ""} min-h-screen bg-black text-white`.trim()}
      >
        <StorefrontHeader
          isAuthenticated={isAuthenticated}
          userEmail={userEmail ?? undefined}
          role={role}
        />
        <main className="min-h-screen pt-28 pb-20 text-white sm:pt-32 md:pb-0">
          {children}
        </main>
      </div>

      <Suspense fallback={null}>
        <ChatQueryOpener onOpenChat={openChat} />
      </Suspense>
      <ChatDrawer isOpen={chatOpen} onClose={() => setChatOpen(false)} />
      <Footer />
      <MobileBottomNav />
    </>
  );
}

function ChatQueryOpener({ onOpenChat }: { onOpenChat: () => void }) {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("chat") === "1") {
      onOpenChat();
    }
  }, [onOpenChat, searchParams]);

  return null;
}
