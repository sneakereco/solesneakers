"use client";

import { createElement, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ExternalLink,
  LayoutDashboard,
  Menu,
  Package,
  Receipt,
  Settings,
  Sparkles,
  Tags,
  Truck,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import type { ProfileRole } from "@/config/constants/roles";

type NavLink = { type: "link"; href: string; label: string; icon: LucideIcon };
type GroupKey = "commerce" | "settings";
type NavGroup = {
  type: "group";
  key: GroupKey;
  label: string;
  icon: LucideIcon;
  activePrefixes: string[];
  children: Array<{ href: string; label: string; icon: LucideIcon }>;
};

const navItems: Array<NavLink | NavGroup> = [
  { type: "link", href: "/admin/dashboard", label: "Overview", icon: LayoutDashboard },
  { type: "link", href: "/admin/inventory", label: "Inventory", icon: Package },
  { type: "link", href: "/admin/featured-items", label: "Featured", icon: Sparkles },
  {
    type: "group",
    key: "commerce",
    label: "Commerce",
    icon: Receipt,
    activePrefixes: [
      "/admin/transactions",
      "/admin/customers",
      "/admin/shipping",
      "/admin/pickups",
    ],
    children: [
      { href: "/admin/transactions", label: "Transactions", icon: Receipt },
      { href: "/admin/customers", label: "Customers", icon: Users },
      { href: "/admin/shipping", label: "Shipping", icon: Truck },
      { href: "/admin/pickups", label: "Pickups", icon: Package },
    ],
  },
  { type: "link", href: "/admin/nexus", label: "Tax & nexus", icon: Receipt },
  { type: "link", href: "/admin/tags", label: "Product tags", icon: Tags },
  {
    type: "group",
    key: "settings",
    label: "Settings",
    icon: Settings,
    activePrefixes: ["/admin/settings"],
    children: [
      { href: "/admin/settings/store-access", label: "Store access", icon: Settings },
      { href: "/admin/settings/shipping", label: "Shipping", icon: Truck },
      { href: "/admin/settings/taxes", label: "Taxes", icon: Receipt },
    ],
  },
];

const roleLabel = (role: ProfileRole) =>
  role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function AdminSidebar({
  userEmail,
  role,
}: {
  userEmail?: string | null;
  role: ProfileRole;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({
    commerce: false,
    settings: false,
  });

  useEffect(() => {
    setOpenGroups((current) => ({
      commerce:
        current.commerce ||
        [
          "/admin/transactions",
          "/admin/customers",
          "/admin/shipping",
          "/admin/pickups",
        ].some((prefix) => pathname.startsWith(prefix)),
      settings: current.settings || pathname.startsWith("/admin/settings"),
    }));
    setIsOpen(false);
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

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const itemClass = (active: boolean) =>
    `group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[0.78rem] font-medium transition-all ${
      active
        ? "bg-white text-black shadow-sm"
        : "text-zinc-400 hover:bg-white/10 hover:text-white"
    }`;

  const navigation = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/10 px-5 py-6">
        <Link href="/" className="group block" aria-label="Sole Sneakers storefront">
          <span className="block text-[0.58rem] font-semibold uppercase tracking-[0.38em] text-zinc-500">
            Management
          </span>
          <span className="mt-2 block text-xl font-bold italic uppercase tracking-[-0.045em] text-white">
            Sole Sneakers
          </span>
        </Link>
      </div>

      <div className="admin-sidebar-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <p className="mb-2 px-3 text-[0.58rem] font-semibold uppercase tracking-[0.24em] text-zinc-600">
          Operations
        </p>
        <nav className="space-y-1">
          {navItems.map((item) => {
            if (item.type === "link") {
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href} className={itemClass(active)}>
                  {createElement(item.icon, {
                    className: `h-4 w-4 ${active ? "text-black" : "text-zinc-500 group-hover:text-white"}`,
                  })}
                  <span>{item.label}</span>
                </Link>
              );
            }

            const active = item.activePrefixes.some((prefix) =>
              pathname.startsWith(prefix),
            );
            const expanded = openGroups[item.key];
            return (
              <div key={item.key}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [item.key]: !current[item.key],
                    }))
                  }
                  className={itemClass(active)}
                  aria-expanded={expanded}
                >
                  {createElement(item.icon, {
                    className: `h-4 w-4 ${active ? "text-black" : "text-zinc-500 group-hover:text-white"}`,
                  })}
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
                {expanded && (
                  <div className="ml-5 mt-1 space-y-1 border-l border-white/10 pl-3">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[0.72rem] transition ${
                          isActive(child.href)
                            ? "bg-white/10 text-white"
                            : "text-zinc-500 hover:text-white"
                        }`}
                      >
                        {createElement(child.icon, { className: "h-3.5 w-3.5" })}
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-white/10 p-4">
        <Link
          href="/admin/profile"
          className={`flex items-center gap-3 rounded-lg p-3 transition ${
            isActive("/admin/profile") ? "bg-white text-black" : "hover:bg-white/10"
          }`}
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              isActive("/admin/profile")
                ? "bg-black text-white"
                : "bg-white/10 text-zinc-300"
            }`}
          >
            <UserRound className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-xs font-medium ${
                isActive("/admin/profile") ? "text-black" : "text-zinc-200"
              }`}
            >
              {userEmail ?? "Admin account"}
            </span>
            <span
              className={`mt-0.5 block text-[0.6rem] uppercase tracking-wider ${
                isActive("/admin/profile") ? "text-zinc-500" : "text-zinc-600"
              }`}
            >
              {roleLabel(role)}
            </span>
          </span>
        </Link>
        <Link
          href="/"
          className="mt-2 flex items-center gap-2 px-3 py-2 text-[0.66rem] font-medium uppercase tracking-[0.14em] text-zinc-500 transition hover:text-white"
        >
          View storefront <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black text-white shadow-xl md:hidden"
        aria-label="Open admin menu"
      >
        <Menu className="h-4.5 w-4.5" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm md:hidden">
          <aside className="h-full w-[min(88vw,19rem)] bg-[#0a0a0a] shadow-2xl">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-black"
              aria-label="Close admin menu"
            >
              <X className="h-4 w-4" />
            </button>
            {navigation}
          </aside>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[17.5rem] border-r border-white/10 bg-[#0a0a0a] md:block">
        {navigation}
      </aside>
    </>
  );
}
