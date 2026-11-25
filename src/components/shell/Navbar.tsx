"use client";

import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { RequestError } from "@/components/ui/RequestError";
import { LoadingState, Skeleton } from "@/components/ui/Skeleton";
import { ActionButton } from "@/components/ui/ActionButton";
import { useMemo, useState, type MouseEvent } from "react";
import Image from "next/image";
import { FeedbackLink } from "@/components/ui/FeedbackLink";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Search, ShoppingCart } from "lucide-react";

import { isAdminRole, type ProfileRole } from "@/config/constants/roles";
import { useSession } from "@/contexts/SessionContext";
import { withRequestDeadline } from "@/lib/http/request-deadline";

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
  cartReady?: boolean;
  role?: ProfileRole | null;
  showAnnouncement?: boolean;
}

export function Navbar({
  isAuthenticated = false,
  userEmail,
  cartCount = 0,
  cartReady = true,
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
  const [menuInvoker, setMenuInvoker] = useState<HTMLButtonElement | null>(null);

  const logout = useAsyncAction();
  const [logoutError, setLogoutError] = useState(false);

  const loginUrl = useMemo(() => {
    if (pathname === "/" || pathname.startsWith("/auth")) {
      return "/auth/login";
    }
    return `/auth/login?next=${encodeURIComponent(pathname)}`;
  }, [pathname]);

  const handleSearchClick = (event: MouseEvent<HTMLButtonElement>) =>
    window.dispatchEvent(
      new CustomEvent("openSearch", { detail: { invoker: event.currentTarget } }),
    );
  const handleCartClick = (event: MouseEvent<HTMLButtonElement>) =>
    window.dispatchEvent(
      new CustomEvent("openCart", { detail: { invoker: event.currentTarget } }),
    );

  const handleLogout = () => {
    void logout
      .run(async () => {
        setLogoutError(false);
        const response = await withRequestDeadline((signal) =>
          fetch("/api/auth/logout", { method: "POST", signal }),
        );
        if (!response.ok) throw new Error("Could not sign out");
        window.dispatchEvent(new CustomEvent("sessionUpdate"));
        window.location.href = "/";
      })
      .catch(() => setLogoutError(true));
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
          <ActionButton
            type="button"
            onClick={(event) => setMenuInvoker(event.currentTarget)}
            className="inline-flex h-11 w-11 items-center justify-start text-zinc-800 transition-colors hover:text-black"
            aria-label="Open menu"
          >
            <Menu className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={1.7} />
          </ActionButton>
        </div>

        <FeedbackLink
          href="/"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          aria-label="Home"
        >
          <div className="flex items-center justify-center">
            <Image
              src="/images/logo.png"
              alt="Solesneakers"
              width={124}
              height={124}
              sizes="124px"
              className="h-[76px] w-[76px] object-contain sm:h-[110px] sm:w-[110px]"
              priority
              unoptimized
            />
          </div>
        </FeedbackLink>

        <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 sm:right-8 md:flex lg:right-14">
          <div className="flex items-center" style={{ gap: "1.75rem" }}>
            {effectiveIsAuthenticated ? (
              <div className="group relative inline-flex">
                <ActionButton
                  type="button"
                  className="inline-flex max-w-[15rem] items-center gap-1 text-xs font-semibold uppercase text-zinc-700 transition-colors duration-150 hover:text-black"
                  style={{ letterSpacing: "0.02em" }}
                  aria-label="Account"
                  data-testid="navbar-user-menu"
                >
                  <span className="truncate">{effectiveUserEmail ?? "Account"}</span>
                  <ChevronDown className="h-3.5 w-3.5 -rotate-180 transition-transform duration-200 group-hover:rotate-0" />
                </ActionButton>

                <div className="invisible absolute right-0 top-full z-50 pt-4 opacity-0 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 motion-safe:transition motion-safe:duration-150">
                  <div className="min-w-full border border-zinc-200 bg-[var(--storefront-surface)] text-black shadow-[0_20px_50px_rgba(0,0,0,0.14)]">
                    {showAdminDashboardLink && (
                      <FeedbackLink
                        href="/admin"
                        className="block border-t border-zinc-200 px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-700 transition-colors duration-150 hover:text-black"
                        style={{ letterSpacing: "0.02em" }}
                      >
                        To Admin Dashboard
                      </FeedbackLink>
                    )}
                    <FeedbackLink
                      href="/account"
                      className="block px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-700 transition-colors duration-150 hover:text-black"
                      style={{ letterSpacing: "0.02em" }}
                    >
                      Account Settings
                    </FeedbackLink>
                    <ActionButton
                      type="button"
                      onClick={handleLogout}
                      pending={logout.pending}
                      pendingLabel="Signing out…"
                      className="block w-full px-4 py-3 text-left text-xs font-semibold uppercase text-zinc-700 transition-colors duration-150 hover:text-black"
                      style={{ letterSpacing: "0.02em" }}
                    >
                      Logout
                    </ActionButton>
                    {logoutError && (
                      <div className="px-4 pb-3">
                        <RequestError message="Sign out failed. Please try again." />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : showAuthButtons ? (
              <FeedbackLink
                href={loginUrl}
                className={actionClassName}
                style={{ letterSpacing: "0.02em" }}
              >
                Login
              </FeedbackLink>
            ) : (
              <LoadingState label="Loading account">
                <div data-testid="navbar-auth-loading">
                  <Skeleton className="h-4 w-16" />
                </div>
              </LoadingState>
            )}

            <ActionButton
              type="button"
              onClick={handleSearchClick}
              className={actionClassName}
              style={{ letterSpacing: "0.02em" }}
            >
              Search
            </ActionButton>

            <ActionButton
              type="button"
              onClick={handleCartClick}
              className={actionClassName}
              style={{ letterSpacing: "0.02em" }}
            >
              {cartReady ? `Cart (${cartCount})` : "Cart"}
            </ActionButton>
          </div>
        </div>

        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center sm:right-6 md:hidden">
          <ActionButton
            type="button"
            onClick={handleSearchClick}
            className="inline-flex h-11 w-11 items-center justify-center text-zinc-800 transition-colors hover:text-black"
            aria-label="Search"
          >
            <Search className="h-[1.15rem] w-[1.15rem]" />
          </ActionButton>

          <ActionButton
            type="button"
            onClick={handleCartClick}
            className="relative inline-flex h-11 w-11 items-center justify-center text-zinc-800 transition-colors hover:text-black"
            aria-label="Cart"
          >
            <ShoppingCart className="h-[1.15rem] w-[1.15rem]" />
            {cartCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex min-h-4 min-w-4 items-center justify-center bg-black px-1 text-[9px] font-semibold leading-none text-white">
                {cartCount}
              </span>
            )}
          </ActionButton>
        </div>
      </div>

      <StoreMenuDrawer
        isOpen={menuInvoker !== null}
        invoker={menuInvoker}
        onClose={() => setMenuInvoker(null)}
      />
    </nav>
  );
}
