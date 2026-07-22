"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Search, ShoppingCart, User } from "lucide-react";

import { isAdminRole, type ProfileRole } from "@/config/constants/roles";
import { useSession } from "@/contexts/SessionContext";

import { StoreMenuDrawer } from "./StoreMenuDrawer";

const announcementItems = [
  "Orders placed before 3PM ship same day",
  "Follow @soles.neakers on IG",
  "New inventory daily",
  "Local pickups near Winston-Salem, High Point, Kernersville, Greensboro NC",
  "Always buying. DM me to get cashed out",
];

interface NavbarProps {
  isAuthenticated?: boolean;
  userEmail?: string;
  cartCount?: number;
  role?: ProfileRole | null;
  showAnnouncement?: boolean;
}

export function Navbar({
  isAuthenticated = false,
  userEmail,
  cartCount = 0,
  role = null,
  showAnnouncement = true,
}: NavbarProps) {
  const pathname = usePathname();
  const {
    user,
    role: sessionRole,
    isAuthenticated: sessionIsAuthenticated,
    isLoading,
  } = useSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const loginUrl = useMemo(() => {
    if (pathname === "/" || pathname.startsWith("/auth")) {
      return "/auth/login";
    }
    return `/auth/login?next=${encodeURIComponent(pathname)}`;
  }, [pathname]);

  const handleSearchClick = () => window.dispatchEvent(new CustomEvent("openSearch"));
  const handleCartClick = () => window.dispatchEvent(new CustomEvent("openCart"));

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.dispatchEvent(new CustomEvent("sessionUpdate"));
    window.location.href = "/";
  };

  const effectiveIsAuthenticated = sessionIsAuthenticated || isAuthenticated;
  const effectiveUserEmail = user?.email ?? userEmail;
  const effectiveRole = sessionRole ?? role;
  const showAdminDashboardLink =
    typeof effectiveRole === "string" && isAdminRole(effectiveRole);
  const showAuthButtons = !isLoading && !effectiveIsAuthenticated;

  const actionClassName =
    "inline-flex whitespace-nowrap text-xs font-semibold uppercase text-zinc-700 transition-all duration-150 hover:text-black hover:font-bold";

  return (
    <nav className="w-full bg-[var(--storefront-surface)] text-black">
      <div
        data-announcement-shell
        className={`storefront-marquee bg-black text-white ${
          showAnnouncement
            ? "storefront-marquee--visible border-b border-black"
            : "storefront-marquee--hidden border-b border-transparent"
        }`}
      >
        <div className="storefront-marquee__track" aria-hidden="true">
          {[0, 1].map((copyIndex) => (
            <div key={copyIndex} className="storefront-marquee__group">
              {announcementItems.map((item) => (
                <span key={`${copyIndex}-${item}`} className="storefront-marquee__item">
                  {item}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div
        data-navbar-shell
        className="relative h-20 border-b border-zinc-200 px-5 sm:h-24 sm:px-8 lg:px-14"
      >
        <div className="absolute left-5 top-1/2 -translate-y-1/2 sm:left-8 lg:left-14">
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            className="inline-flex items-center gap-3 text-zinc-800 transition-colors hover:text-black"
            aria-label="Open menu"
          >
            <Menu className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.7} />
          </button>
        </div>

        <Link
          href="/"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          aria-label="Home"
        >
          <div className="flex items-center justify-center">
            <Image
              src="/images/logo.png"
              alt="Sole Sneakers"
              width={124}
              height={124}
              sizes="124px"
              className="h-[96px] w-[96px] object-contain sm:h-[118px] sm:w-[118px]"
              priority
              unoptimized
            />
          </div>
        </Link>

        <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 md:flex sm:right-8 lg:right-14">
          <div className="flex items-center" style={{ gap: "1.75rem" }}>
            {effectiveIsAuthenticated ? (
              <div className="group relative inline-flex">
                <button
                  type="button"
                  className="inline-flex max-w-[15rem] items-center gap-1 text-xs font-semibold uppercase text-zinc-700 transition-colors duration-150 hover:text-black"
                  style={{ letterSpacing: "0.02em" }}
                  aria-label="Account"
                  data-testid="navbar-user-menu"
                >
                  <span className="truncate">{effectiveUserEmail ?? "Account"}</span>
                  <ChevronDown className="h-3.5 w-3.5 -rotate-180 transition-transform duration-200 group-hover:rotate-0" />
                </button>

                <div className="pointer-events-none absolute right-0 top-full z-50 pt-4 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
                  <div className="min-w-full border border-zinc-200 bg-[var(--storefront-surface)] text-black shadow-[0_20px_50px_rgba(0,0,0,0.14)]">
                    {showAdminDashboardLink && (
                      <Link
                        href="/admin"
                        className="block border-t border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-700 transition-colors duration-150 hover:text-black"
                        style={{ letterSpacing: "0.02em" }}
                      >
                        To Admin Dashboard
                      </Link>
                    )}
                    <Link
                      href="/account"
                      className="block px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-700 transition-colors duration-150 hover:text-black"
                      style={{ letterSpacing: "0.02em" }}
                    >
                      Account Settings
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        void handleLogout();
                      }}
                      className="block w-full px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-700 transition-colors duration-150 hover:text-black"
                      style={{ letterSpacing: "0.02em" }}
                    >
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            ) : showAuthButtons ? (
              <Link
                href={loginUrl}
                className={actionClassName}
                style={{ letterSpacing: "0.02em" }}
              >
                Login
              </Link>
            ) : (
              <div
                className="h-4 w-16 animate-pulse bg-zinc-200"
                aria-label="Loading account"
                data-testid="navbar-auth-loading"
              />
            )}

            <button
              type="button"
              onClick={handleSearchClick}
              className={actionClassName}
              style={{ letterSpacing: "0.02em" }}
            >
              Search
            </button>

            <button
              type="button"
              onClick={handleCartClick}
              className={actionClassName}
              style={{ letterSpacing: "0.02em" }}
            >
              {`Cart (${cartCount})`}
            </button>
          </div>
        </div>

        <div className="absolute right-5 top-1/2 flex -translate-y-1/2 items-center gap-4 sm:right-8 md:hidden">
          <button
            type="button"
            onClick={handleSearchClick}
            className="text-zinc-800 transition-colors hover:text-black"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={handleCartClick}
            className="relative text-zinc-800 transition-colors hover:text-black"
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
              className="text-zinc-800 transition-colors hover:text-black"
              aria-label="Account"
            >
              <User className="h-5 w-5" />
            </Link>
          )}
        </div>
      </div>

      <StoreMenuDrawer isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
    </nav>
  );
}
