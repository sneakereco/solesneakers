"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  Search,
  Settings,
  ShoppingCart,
  User,
  X,
} from "lucide-react";

import { CLOTHING_ALPHA_SIZES, JEAN_SIZES, SHOE_SIZES } from "@/config/constants/sizes";
import { isAdminRole, type ProfileRole } from "@/config/constants/roles";
import { useSession } from "@/contexts/SessionContext";
import { logError } from "@/lib/utils/log";

interface NavbarProps {
  isAuthenticated?: boolean;
  userEmail?: string;
  cartCount?: number;
  role?: ProfileRole | null;
}

function buildStoreHref(params: Record<string, string | string[]>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((entry) => sp.append(key, entry));
      return;
    }
    if (value === undefined || value === null || value === "") {
      return;
    }
    sp.set(key, value);
  });
  const query = sp.toString();
  return query ? `/store?${query}` : "/store";
}

const FALLBACK_BRAND_GROUPS = [
  { key: "nike", label: "Nike" },
  { key: "jordan", label: "Air Jordan" },
  { key: "asics", label: "ASICS" },
  { key: "vale", label: "Vale" },
  { key: "godspeed", label: "Godspeed" },
];

const SHOP_LINKS = [
  { label: "Shop All", href: "/store" },
  { label: "Sneakers", href: buildStoreHref({ category: "sneakers" }) },
  { label: "Clothing", href: buildStoreHref({ category: "clothing" }) },
  { label: "Accessories", href: buildStoreHref({ category: "accessories" }) },
  { label: "Electronics", href: buildStoreHref({ category: "electronics" }) },
];

const QUICK_LINKS = [
  { label: "Brands", href: "/brands" },
  { label: "Contact", href: "/contact" },
  { label: "Hours", href: "/hours" },
  { label: "Shipping", href: "/shipping" },
];

const MENU_SHOE_SIZES = SHOE_SIZES.filter((size) => !size.trim().startsWith("EU")).slice(
  0,
  10,
);

export function Navbar({
  isAuthenticated = false,
  userEmail,
  cartCount = 0,
  role = null,
}: NavbarProps) {
  const pathname = usePathname();
  const {
    user,
    role: sessionRole,
    isAuthenticated: sessionIsAuthenticated,
    isLoading,
  } = useSession();
  const [isMounted, setIsMounted] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [brandGroups, setBrandGroups] = useState<Array<{ key: string; label: string }>>(
    [],
  );

  const loginUrl = useMemo(() => {
    if (pathname === "/") {
      return "/auth/login";
    }
    return `/auth/login?next=${encodeURIComponent(pathname)}`;
  }, [pathname]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const loadBrandGroups = async () => {
      try {
        const response = await fetch("/api/store/catalog/brand-groups");
        const data = await response.json();
        if (response.ok && Array.isArray(data.groups)) {
          setBrandGroups(data.groups);
        }
      } catch (error) {
        logError(error, { layer: "frontend", event: "navbar_load_brand_groups" });
      }
    };

    void loadBrandGroups();
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMenuOpen]);

  const handleSearchClick = () => window.dispatchEvent(new CustomEvent("openSearch"));
  const handleCartClick = () => window.dispatchEvent(new CustomEvent("openCart"));

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.dispatchEvent(new CustomEvent("sessionUpdate"));
    window.location.href = "/";
  };

  const effectiveIsAuthenticated = sessionIsAuthenticated || isAuthenticated;
  const effectiveUserEmail = user?.email ?? userEmail;
  const effectiveRole = sessionRole ?? role ?? null;
  const isAdminUser = effectiveRole ? isAdminRole(effectiveRole) : false;
  const showAuthButtons = !isLoading && !effectiveIsAuthenticated;

  const resolvedBrandGroups =
    brandGroups.length > 0 ? brandGroups : FALLBACK_BRAND_GROUPS;
  const visibleBrandGroups = resolvedBrandGroups
    .filter(
      (group) =>
        group.key !== "designer" &&
        group.key !== "new_balance" &&
        group.key !== "yeezy" &&
        group.key !== "other",
    )
    .slice(0, 6);

  const actionClassName =
    "hidden md:inline-flex text-[0.95rem] font-medium uppercase tracking-[0.04em] text-zinc-700 transition-all duration-150 hover:font-semibold hover:text-black";

  const menuOverlay = (
    <div className="fixed inset-0 z-[9999] bg-black/45 backdrop-blur-sm">
      <div className="h-full w-full md:max-w-[620px] bg-white text-black shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-5 sm:px-7">
          <div>
            <div className="text-[0.65rem] uppercase tracking-[0.35em] text-zinc-500">
              Realdealkickzsc
            </div>
            <div className="mt-1 text-xl font-semibold">Browse the storefront</div>
          </div>
          <button
            type="button"
            onClick={() => setIsMenuOpen(false)}
            className="flex h-11 w-11 items-center justify-center text-zinc-700 transition-colors hover:text-black"
            aria-label="Close menu"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="h-[calc(100%-5rem)] overflow-y-auto px-5 py-6 sm:px-7 sm:py-8">
          <div className="grid gap-8 md:grid-cols-2">
            <section className="space-y-3">
              <div className="text-[0.65rem] uppercase tracking-[0.32em] text-zinc-500">
                Shop
              </div>
              <div className="space-y-2">
                {SHOP_LINKS.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setIsMenuOpen(false)}
                    className="group flex items-center justify-between border-b border-zinc-200 py-3 text-base font-medium transition-colors hover:text-zinc-600"
                  >
                    <span>{item.label}</span>
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-[0.65rem] uppercase tracking-[0.32em] text-zinc-500">
                Quick Links
              </div>
              <div className="space-y-2">
                {QUICK_LINKS.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setIsMenuOpen(false)}
                    className="group flex items-center justify-between border-b border-zinc-200 py-3 text-base font-medium transition-colors hover:text-zinc-600"
                  >
                    <span>{item.label}</span>
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                ))}
                {isAdminUser && (
                  <Link
                    href="/admin/dashboard"
                    onClick={() => setIsMenuOpen(false)}
                    className="group flex items-center justify-between border-b border-zinc-200 py-3 text-base font-medium transition-colors hover:text-zinc-600"
                  >
                    <span>Admin Dashboard</span>
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-[0.65rem] uppercase tracking-[0.32em] text-zinc-500">
                Featured Brands
              </div>
              <div className="flex flex-wrap gap-2">
                {visibleBrandGroups.map((group) => (
                  <Link
                    key={group.key}
                    href={buildStoreHref({ brand: group.label })}
                    onClick={() => setIsMenuOpen(false)}
                    className="border border-zinc-200 px-3 py-2 text-sm transition-colors hover:bg-zinc-100"
                  >
                    {group.label}
                  </Link>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <div className="text-[0.65rem] uppercase tracking-[0.32em] text-zinc-500">
                Popular Sizes
              </div>
              <div>
                <div className="mb-2 text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Sneakers
                </div>
                <div className="flex flex-wrap gap-2">
                  {MENU_SHOE_SIZES.map((size) => (
                    <Link
                      key={size}
                      href={buildStoreHref({ category: "sneakers", sizeShoe: size })}
                      onClick={() => setIsMenuOpen(false)}
                      className="border border-zinc-200 px-3 py-2 text-sm transition-colors hover:bg-zinc-100"
                    >
                      {size}
                    </Link>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs uppercase tracking-[0.24em] text-zinc-500">
                  Clothing
                </div>
                <div className="flex flex-wrap gap-2">
                  {[...CLOTHING_ALPHA_SIZES.slice(0, 5), ...JEAN_SIZES.slice(0, 3)].map(
                    (size) => (
                      <Link
                        key={size}
                        href={buildStoreHref({
                          category: "clothing",
                          sizeClothing: size,
                        })}
                        onClick={() => setIsMenuOpen(false)}
                        className="border border-zinc-200 px-3 py-2 text-sm transition-colors hover:bg-zinc-100"
                      >
                        {size}
                      </Link>
                    ),
                  )}
                </div>
              </div>
            </section>
          </div>

          {effectiveUserEmail && (
            <div className="mt-8 border-t border-zinc-200 pt-6 text-sm text-zinc-600">
              Signed in as{" "}
              <span className="font-medium text-black">{effectiveUserEmail}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <nav className="h-28 w-full border-b border-zinc-200 bg-white text-black sm:h-32">
      <div className="relative flex h-full items-center justify-between px-5 sm:px-8 lg:px-14">
        <div className="flex min-w-0 flex-1 items-center">
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            className="inline-flex items-center gap-3 text-zinc-800 transition-colors hover:text-black"
            aria-label="Open menu"
          >
            <Menu className="h-9 w-9 sm:h-10 sm:w-10" strokeWidth={1.7} />
          </button>
        </div>

        <Link
          href="/"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          aria-label="Home"
        >
          <div className="flex items-center justify-center">
            <Image
              src="/images/logo.jpg"
              alt="Sole Sneakers"
              width={116}
              height={116}
              sizes="116px"
              className="h-[92px] w-[92px] object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)] sm:h-[116px] sm:w-[116px]"
              priority
              unoptimized
            />
          </div>
        </Link>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-5 sm:gap-9 lg:gap-10">
          {effectiveIsAuthenticated ? (
            <div className="group relative hidden md:block">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[0.95rem] font-medium uppercase tracking-[0.04em] text-zinc-700 transition-all duration-150 hover:font-semibold hover:text-black"
                aria-label="Account"
                data-testid="navbar-user-menu"
              >
                <span>Login</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>

              <div className="pointer-events-none absolute right-0 top-full z-50 pt-3 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
                <div className="w-64 border border-zinc-200 bg-white p-2 text-black shadow-2xl">
                  {effectiveUserEmail && (
                    <div className="border-b border-zinc-200 px-3 py-3 text-xs text-zinc-500">
                      {effectiveUserEmail}
                    </div>
                  )}
                  <Link
                    href="/account"
                    className="mt-1 flex items-center gap-2 px-3 py-3 text-sm transition-colors hover:bg-zinc-100"
                  >
                    <Settings className="h-4 w-4" />
                    Account Settings
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      void handleLogout();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm transition-colors hover:bg-zinc-100"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              </div>
            </div>
          ) : showAuthButtons ? (
            <Link href={loginUrl} className={actionClassName}>
              Login
            </Link>
          ) : (
            <div
              className="hidden h-4 w-16 animate-pulse bg-zinc-200 md:block"
              aria-label="Loading account"
              data-testid="navbar-auth-loading"
            />
          )}

          <button type="button" onClick={handleSearchClick} className={actionClassName}>
            Search
          </button>

          <button type="button" onClick={handleCartClick} className={actionClassName}>
            {`Cart (${cartCount})`}
          </button>

          <button
            type="button"
            onClick={handleSearchClick}
            className="text-zinc-800 transition-colors hover:text-black md:hidden"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={handleCartClick}
            className="relative text-zinc-800 transition-colors hover:text-black md:hidden"
            aria-label="Cart"
          >
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 && (
              <span className="absolute -right-2 -top-2 text-[10px] font-semibold text-black">
                {cartCount}
              </span>
            )}
          </button>

          {effectiveIsAuthenticated && (
            <Link
              href="/account"
              className="text-zinc-800 transition-colors hover:text-black md:hidden"
              aria-label="Account"
            >
              <User className="h-5 w-5" />
            </Link>
          )}
        </div>
      </div>

      {isMounted && isMenuOpen ? createPortal(menuOverlay, document.body) : null}
    </nav>
  );
}
