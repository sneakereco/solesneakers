"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";

import { TOP_BRAND_SHORTCUTS } from "@/config/constants/storefront";

type MenuPanel = "brand" | "size" | "category";

type StoreMenuDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
};

type SizeOption = {
  id: string;
  label: string;
  sizeType: string;
};

type BrandOption = { id: string; label: string };

const DRAWER_TRANSITION_MS = 460;
const PANEL_TRANSITION_MS = 380;
const COLLAPSIBLE_TRANSITION_MS = 360;
const MENU_EASING = "cubic-bezier(0.76, 0, 0.24, 1)";

const CATEGORY_LINKS = [
  { label: "Sneakers", value: "sneakers" },
  { label: "Clothing", value: "clothing" },
  { label: "Accessories", value: "accessories" },
  { label: "Electronics", value: "electronics" },
];

const buildStoreHref = (params: Record<string, string>) => {
  const searchParams = new URLSearchParams(params);
  const query = searchParams.toString();
  return query ? `/store?${query}` : "/store";
};

function DrawerLink({
  children,
  href,
  onNavigate,
  variant = "nested",
}: {
  children: React.ReactNode;
  href: string;
  onNavigate: () => void;
  variant?: "nested" | "row";
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={
        variant === "row"
          ? "flex min-h-[61px] items-center border-b border-zinc-200 text-[13px] font-normal uppercase tracking-[0.02em] text-zinc-800 transition-colors hover:text-black"
          : "block py-3 text-[0.9rem] text-zinc-700 transition-colors hover:text-black"
      }
    >
      {children}
    </Link>
  );
}

function CollapsibleContent({
  children,
  isOpen,
}: {
  children: React.ReactNode;
  isOpen: boolean;
}) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity]"
      style={{
        gridTemplateRows: isOpen ? "1fr" : "0fr",
        opacity: isOpen ? 1 : 0,
        transitionDuration: `${COLLAPSIBLE_TRANSITION_MS}ms`,
        transitionTimingFunction: MENU_EASING,
      }}
    >
      <div
        className="min-h-0 overflow-hidden transition-transform"
        style={{
          transform: isOpen ? "translateY(0)" : "translateY(-0.75rem)",
          transitionDuration: `${COLLAPSIBLE_TRANSITION_MS}ms`,
          transitionTimingFunction: MENU_EASING,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SizeGroup({
  category,
  isOpen,
  label,
  onNavigate,
  onToggle,
  options,
}: {
  category: "clothing" | "sneakers";
  isOpen: boolean;
  label: string;
  onNavigate: () => void;
  onToggle: () => void;
  options: SizeOption[];
}) {
  return (
    <section className="border-b border-zinc-200">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[61px] w-full items-center justify-between py-4 text-left text-[13px] font-normal uppercase tracking-[0.02em] text-zinc-800"
        aria-expanded={isOpen}
      >
        <span>{label}</span>
        {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </button>

      <CollapsibleContent isOpen={isOpen}>
        <div className="mb-5 ml-2 border-l border-zinc-200 pl-6 pt-1">
          {options.map((option) => (
            <DrawerLink
              key={`${label}-${option.id}`}
              href={buildStoreHref({ category, sizeIds: option.id })}
              onNavigate={onNavigate}
            >
              {option.label}
            </DrawerLink>
          ))}
        </div>
      </CollapsibleContent>
    </section>
  );
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex h-20 items-center gap-4 border-b border-zinc-200 px-7 md:border-b-0 md:px-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-10 w-10 items-center justify-center text-zinc-700 md:hidden"
        aria-label="Back to main menu"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <h2 className="text-xs font-medium uppercase tracking-[0.04em] md:hidden">
        {title}
      </h2>
    </div>
  );
}

export function StoreMenuDrawer({ isOpen, onClose }: StoreMenuDrawerProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const [activePanel, setActivePanel] = useState<MenuPanel | null>(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [expandedSizes, setExpandedSizes] = useState<Record<string, boolean>>({});
  const [expandedBrandSections, setExpandedBrandSections] = useState<
    Record<string, boolean>
  >({});
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelTimeoutRef = useRef<number | null>(null);
  const closeFromEffect = useEffectEvent(onClose);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      if (panelTimeoutRef.current !== null) {
        window.clearTimeout(panelTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setIsVisible(true));
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }

    setIsVisible(false);
    const timeout = window.setTimeout(() => {
      setShouldRender(false);
      setActivePanel(null);
      setIsPanelVisible(false);
    }, DRAWER_TRANSITION_MS);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  useEffect(() => {
    if (!shouldRender) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeFromEffect();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shouldRender]);

  useEffect(() => {
    if (!isOpen || (brands.length > 0 && sizes.length > 0)) {
      return;
    }
    const controller = new AbortController();
    void fetch("/api/store/taxonomy", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((data) => {
        setBrands(data.brands ?? []);
        setSizes(data.sizes ?? []);
      })
      .catch((error) => {
        if ((error as { name?: string })?.name !== "AbortError") {
          setBrands([]);
          setSizes([]);
        }
      });
    return () => controller.abort();
  }, [brands.length, isOpen, sizes.length]);

  if (!isMounted || !shouldRender) {
    return null;
  }

  const closeMenu = () => {
    onClose();
  };

  const openPanel = (panel: MenuPanel) => {
    if (panelTimeoutRef.current !== null) {
      window.clearTimeout(panelTimeoutRef.current);
      panelTimeoutRef.current = null;
    }

    // Once the second column is open, swap its content without replaying its entrance.
    if (activePanel && isPanelVisible) {
      setActivePanel(panel);
      return;
    }

    setActivePanel(panel);
    window.requestAnimationFrame(() => setIsPanelVisible(true));
  };

  const closePanel = () => {
    setIsPanelVisible(false);
    if (panelTimeoutRef.current !== null) {
      window.clearTimeout(panelTimeoutRef.current);
    }
    panelTimeoutRef.current = window.setTimeout(() => {
      setActivePanel(null);
      panelTimeoutRef.current = null;
    }, PANEL_TRANSITION_MS);
  };

  const toggleSize = (key: string) => {
    setExpandedSizes((current) => ({ ...current, [key]: !current[key] }));
  };
  const toggleBrandSection = (key: string) => {
    setExpandedBrandSections((current) => ({ ...current, [key]: !current[key] }));
  };

  const panelTitle =
    activePanel === "brand"
      ? "Shop by Brand"
      : activePanel === "size"
        ? "Shop by Size"
        : "Shop by Category";
  const clothingOptions = sizes.filter(
    (size) => size.sizeType === "clothing" && !/^\d+$/.test(size.label),
  );
  const jeanOptions = sizes.filter(
    (size) => size.sizeType === "clothing" && /^\d+$/.test(size.label),
  );
  const shoeOptions = sizes.filter((size) => size.sizeType === "shoe");
  const mensOptions = shoeOptions.filter((size) => /^\d+(?:\.\d+)?M\b/.test(size.label));
  const womensOptions = shoeOptions.filter((size) =>
    /\/\s*\d+(?:\.\d+)?W\b/.test(size.label),
  );
  const youthOptions = shoeOptions.filter((size) => /^\d+(?:\.\d+)?Y\b/.test(size.label));
  const euOptions = shoeOptions.filter((size) => size.label.startsWith("EU "));
  const brandMap = new Map(
    brands.map((brand) => [brand.label.trim().toLowerCase(), brand] as const),
  );
  const topBrandLinks = TOP_BRAND_SHORTCUTS.map((shortcut) => {
    const matchedBrand = shortcut.brandLabel
      ? brandMap.get(shortcut.brandLabel.trim().toLowerCase())
      : null;
    return {
      label: shortcut.label,
      href: matchedBrand
        ? buildStoreHref({ brandIds: matchedBrand.id })
        : shortcut.query
          ? buildStoreHref({ q: shortcut.query })
          : "/brands",
    };
  });

  const drawer = (
    <div
      className="fixed inset-0 z-[9999] transition-opacity"
      style={{
        backgroundColor: "rgba(0,0,0,0.46)",
        opacity: isVisible ? 1 : 0,
        transitionDuration: `${DRAWER_TRANSITION_MS}ms`,
        transitionTimingFunction: MENU_EASING,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeMenu();
        }
      }}
    >
      <aside
        className="relative flex h-[100dvh] w-full overflow-hidden bg-white text-black shadow-2xl transition-[max-width,transform]"
        style={{
          maxWidth: isPanelVisible ? "784px" : "392px",
          transform: isVisible ? "translate3d(0,0,0)" : "translate3d(-100%,0,0)",
          transitionDuration: `${DRAWER_TRANSITION_MS}ms`,
          transitionTimingFunction: MENU_EASING,
          willChange: "transform, max-width",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Store menu"
      >
        <div className="h-full w-full shrink-0 bg-white md:w-[392px] md:border-r md:border-zinc-200">
          <div className="flex h-20 items-center px-6 md:px-8">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeMenu}
              className="inline-flex h-10 w-10 items-center justify-start text-zinc-800 transition-colors hover:text-black"
              aria-label="Close menu"
            >
              <X className="h-6 w-6" strokeWidth={1.5} />
            </button>
          </div>

          <nav className="px-7 md:px-8" aria-label="Store navigation">
            {(
              [
                ["brand", "Shop by Brand"],
                ["size", "Shop by Size"],
                ["category", "Shop by Category"],
              ] as const
            ).map(([panel, label]) => (
              <button
                key={panel}
                type="button"
                onClick={() => openPanel(panel)}
                className="flex min-h-[61px] w-full items-center justify-between border-b border-zinc-200 text-left text-[13px] font-normal uppercase tracking-[0.02em] text-zinc-800 transition-colors hover:text-black"
                aria-expanded={activePanel === panel && isPanelVisible}
              >
                <span>{label}</span>
                <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            ))}

            <Link
              href="/store"
              onClick={closeMenu}
              className="flex min-h-[61px] items-center border-b border-zinc-200 text-[13px] font-normal uppercase tracking-[0.02em] text-zinc-800 transition-colors hover:text-black"
            >
              Shop All
            </Link>
          </nav>
        </div>

        <section
          className="absolute inset-0 z-10 h-full w-full bg-white md:static md:w-[392px] md:shrink-0"
          style={{
            opacity: isPanelVisible ? 1 : 0,
            transform: isPanelVisible ? "translate3d(0,0,0)" : "translate3d(2rem,0,0)",
            pointerEvents: isPanelVisible ? "auto" : "none",
            transitionProperty: "opacity, transform",
            transitionDuration: `${PANEL_TRANSITION_MS}ms`,
            transitionTimingFunction: MENU_EASING,
            willChange: "opacity, transform",
          }}
        >
          {activePanel && <PanelHeader title={panelTitle} onBack={closePanel} />}

          <div className="h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain px-7 pb-10 md:px-8">
            {activePanel === "brand" ? (
              <div>
                <DrawerLink href="/brands" onNavigate={closeMenu} variant="row">
                  All Brands
                </DrawerLink>
                <section className="border-b border-zinc-200">
                  <button
                    type="button"
                    onClick={() => toggleBrandSection("topBrands")}
                    className="flex min-h-[61px] w-full items-center justify-between text-left text-[13px] font-normal uppercase tracking-[0.02em] text-zinc-800"
                    aria-expanded={!!expandedBrandSections.topBrands}
                  >
                    <span>Top Brands</span>
                    {expandedBrandSections.topBrands ? (
                      <Minus className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </button>

                  <CollapsibleContent isOpen={!!expandedBrandSections.topBrands}>
                    <div className="mb-5 ml-2 border-l border-zinc-200 pl-6 pt-1">
                      {topBrandLinks.map((brand) => (
                        <DrawerLink
                          key={brand.label}
                          href={brand.href}
                          onNavigate={closeMenu}
                        >
                          {brand.label}
                        </DrawerLink>
                      ))}
                    </div>
                  </CollapsibleContent>
                </section>
              </div>
            ) : activePanel === "category" ? (
              <div>
                {CATEGORY_LINKS.map((category) => (
                  <DrawerLink
                    key={category.value}
                    href={buildStoreHref({ category: category.value })}
                    onNavigate={closeMenu}
                    variant="row"
                  >
                    {category.label}
                  </DrawerLink>
                ))}
              </div>
            ) : activePanel === "size" ? (
              <div>
                <SizeGroup
                  label="Clothing"
                  category="clothing"
                  options={clothingOptions}
                  isOpen={!!expandedSizes.clothing}
                  onToggle={() => toggleSize("clothing")}
                  onNavigate={closeMenu}
                />
                <SizeGroup
                  label="Jeans"
                  category="clothing"
                  options={jeanOptions}
                  isOpen={!!expandedSizes.jeans}
                  onToggle={() => toggleSize("jeans")}
                  onNavigate={closeMenu}
                />
                <SizeGroup
                  label="Men's"
                  category="sneakers"
                  options={mensOptions}
                  isOpen={!!expandedSizes.mens}
                  onToggle={() => toggleSize("mens")}
                  onNavigate={closeMenu}
                />
                <SizeGroup
                  label="Women's"
                  category="sneakers"
                  options={womensOptions}
                  isOpen={!!expandedSizes.womens}
                  onToggle={() => toggleSize("womens")}
                  onNavigate={closeMenu}
                />
                <SizeGroup
                  label="Youth"
                  category="sneakers"
                  options={youthOptions}
                  isOpen={!!expandedSizes.youth}
                  onToggle={() => toggleSize("youth")}
                  onNavigate={closeMenu}
                />
                <SizeGroup
                  label="European"
                  category="sneakers"
                  options={euOptions}
                  isOpen={!!expandedSizes.eu}
                  onToggle={() => toggleSize("eu")}
                  onNavigate={closeMenu}
                />
              </div>
            ) : null}
          </div>
        </section>
      </aside>
    </div>
  );

  return createPortal(drawer, document.body);
}
