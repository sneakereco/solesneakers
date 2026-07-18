"use client";

import { createElement, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  LayoutDashboard,
  Menu,
  Package,
  Receipt,
  Settings,
  Star,
  Truck,
  User,
  X,
  type LucideIcon,
} from "lucide-react";

import { Tooltip } from "@/components/ui/Tooltip";
import type { ProfileRole } from "@/config/constants/roles";

type NavLink = { type: "link"; href: string; label: string; icon: LucideIcon };
type GroupKey = "activity" | "settings";
type NavGroup = {
  type: "group";
  key: GroupKey;
  label: string;
  icon: LucideIcon;
  activePrefixes: string[];
  children: Array<{ href: string; label: string }>;
};

const navItems: Array<NavLink | NavGroup> = [
  { type: "link", href: "/", label: "Website", icon: Globe },
  { type: "link", href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { type: "link", href: "/admin/inventory", label: "Inventory", icon: Package },
  {
    type: "group",
    key: "activity",
    label: "Activity",
    icon: Truck,
    activePrefixes: [
      "/admin/transactions",
      "/admin/customers",
      "/admin/shipping",
      "/admin/pickups",
    ],
    children: [
      { href: "/admin/transactions", label: "Transactions" },
      { href: "/admin/customers", label: "Customers" },
      { href: "/admin/shipping", label: "Shipping" },
      { href: "/admin/pickups", label: "Pickups" },
    ],
  },
  { type: "link", href: "/admin/nexus", label: "Tax & Nexus", icon: Receipt },
  { type: "link", href: "/admin/featured-items", label: "Featured Items", icon: Star },
  { type: "link", href: "/admin/catalog", label: "Tags", icon: Package },
  {
    type: "group",
    key: "settings",
    label: "Settings",
    icon: Settings,
    activePrefixes: ["/admin/settings"],
    children: [
      { href: "/admin/settings/store-access", label: "Store Access" },
      { href: "/admin/settings/shipping", label: "Shipping" },
      { href: "/admin/settings/taxes", label: "Taxes" },
    ],
  },
];

export function AdminSidebar({
  userEmail: _userEmail,
  role: _role,
}: {
  userEmail?: string | null;
  role: ProfileRole;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({
    activity: false,
    settings: false,
  });

  useEffect(() => {
    setOpenGroups((current) => ({
      activity:
        current.activity ||
        [
          "/admin/transactions",
          "/admin/customers",
          "/admin/shipping",
          "/admin/pickups",
        ].some((prefix) => pathname.startsWith(prefix)),
      settings: current.settings || pathname.startsWith("/admin/settings"),
    }));
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const sidebarContent = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="admin-sidebar-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
            Workspace
          </div>
          <div className="flex items-center gap-2 rounded-sm bg-zinc-950 px-3 py-2 text-[13px] text-white">
            <LayoutDashboard className="h-4 w-4" />
            <span className="font-medium">Admin</span>
          </div>
          <div className="mt-4 border-t border-zinc-800/70" />
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const baseClass =
              "flex items-center gap-3 rounded-sm border px-4 py-3 transition-colors";
            if (item.type === "link") {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`${baseClass} ${
                    active
                      ? "border-zinc-800/70 bg-zinc-950 text-white"
                      : "border-transparent text-gray-400 hover:border-zinc-800/70 hover:bg-zinc-950"
                  }`}
                >
                  {createElement(item.icon, { className: "h-5 w-5" })}
                  <span className="text-[13px] sm:text-[15px]">{item.label}</span>
                </Link>
              );
            }

            const active = item.activePrefixes.some((prefix) =>
              pathname.startsWith(prefix),
            );
            const expanded = openGroups[item.key];
            return (
              <div key={item.key} className="space-y-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [item.key]: !current[item.key],
                    }))
                  }
                  className={`${baseClass} w-full justify-between ${
                    active
                      ? "border-zinc-800/70 bg-zinc-950 text-white"
                      : "border-transparent text-gray-400 hover:border-zinc-800/70 hover:bg-zinc-950"
                  }`}
                  aria-expanded={expanded}
                >
                  <span className="flex items-center gap-3">
                    {createElement(item.icon, { className: "h-5 w-5" })}
                    <span className="text-[13px] sm:text-[15px]">{item.label}</span>
                  </span>
                  {expanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                {expanded && (
                  <div className="ml-4 space-y-1 border-l border-zinc-800/70 pl-3">
                    {item.children.map((child) => {
                      const childActive = pathname.startsWith(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={() => setIsOpen(false)}
                          className={`block rounded-sm border px-3 py-2 text-[12px] transition-colors sm:text-[14px] ${
                            childActive
                              ? "border-red-900/30 bg-red-900/20 text-white"
                              : "border-transparent text-gray-400 hover:border-zinc-800/70 hover:bg-zinc-950 hover:text-white"
                          }`}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="-mx-6 flex-none border-t border-zinc-800/70 bg-zinc-950 px-6 py-3">
        <Tooltip label="Profile" side="top">
          <Link
            href="/admin/profile"
            onClick={() => setIsOpen(false)}
            aria-label="Profile"
            className="flex h-12 w-full items-center justify-center rounded-sm transition-colors hover:bg-zinc-900"
          >
            <User className="h-5 w-5 text-zinc-400" />
          </Link>
        </Tooltip>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed right-5 top-5 z-40 rounded-sm bg-red-600 p-3 text-white md:hidden"
        aria-label="Open admin menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black md:hidden">
          <div className="flex h-full flex-col px-6 pb-0 pt-6">
            <div className="mb-8 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">Admin Menu</h2>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Close">
                <X className="h-6 w-6 text-gray-400" />
              </button>
            </div>
            <div className="min-h-0 flex-1">{sidebarContent}</div>
          </div>
        </div>
      )}

      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-zinc-800/70 bg-zinc-900 p-6 md:block">
        <h2 className="mb-8 text-2xl font-bold text-white">Admin</h2>
        <div className="h-[calc(100%-4rem)]">{sidebarContent}</div>
      </aside>
    </>
  );
}
