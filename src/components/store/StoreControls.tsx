"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useEffect, useRef, useState } from "react";
import { useStoreNavigation } from "./StoreNavigation";
import { ChevronDown, ChevronLeft, ChevronRight, Grid2X2, List } from "lucide-react";

interface StoreControlsProps {
  total: number;
  page: number;
  pageCount: number;
  limit: number;
  sort: string;
  view?: "grid" | "list";
  showSortControls?: boolean;
  showPagination?: boolean;
}

const MAX_PAGE_BUTTONS = 5;
const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "name_asc", label: "Title: A-Z" },
  { value: "name_desc", label: "Title: Z-A" },
  { value: "oldest", label: "Date: Old to New" },
  { value: "newest", label: "Date: New to Old" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

export function StoreControls({
  total,
  page,
  pageCount,
  sort,
  view = "grid",
  showSortControls = true,
  showPagination = true,
}: StoreControlsProps) {
  const { isPending, updateQuery } = useStoreNavigation();
  const sortTriggerRef = useRef<HTMLButtonElement>(null);
  const sortContainerRef = useRef<HTMLDivElement>(null);
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => {
    if (!sortOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!sortContainerRef.current?.contains(event.target as Node)) {
        setSortOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortOpen(false);
        sortTriggerRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sortOpen]);

  const updateParams = (updates: Record<string, string | number>, scroll = false) => {
    updateQuery((params) => {
      Object.entries(updates).forEach(([key, value]) => params.set(key, String(value)));
    }, scroll);
  };

  const pageNumbers = (() => {
    if (pageCount <= 1) {
      return [1];
    }
    const half = Math.floor(MAX_PAGE_BUTTONS / 2);
    let start = Math.max(1, page - half);
    const end = Math.min(pageCount, start + MAX_PAGE_BUTTONS - 1);
    if (end - start < MAX_PAGE_BUTTONS - 1) {
      start = Math.max(1, end - MAX_PAGE_BUTTONS + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  })();

  const selectedSort =
    SORT_OPTIONS.find((option) => option.value === sort) ?? SORT_OPTIONS[4];

  return (
    <>
      {showSortControls && (
        <div
          className="sticky z-40 border-y border-zinc-300 bg-[var(--storefront-surface)] motion-safe:transition-[top] motion-safe:duration-300 motion-safe:ease-out"
          style={{ top: "var(--rdk-visible-header-height, 0px)" }}
          data-storefront-toolbar
        >
          <div className="grid min-h-14 grid-cols-[96px_1fr] md:grid-cols-[112px_1fr_224px]">
            <div className="flex items-center justify-center gap-1 border-r border-zinc-300">
              <ActionButton
                type="button"
                onClick={() => updateParams({ view: "grid", page: 1 })}
                className={`grid h-11 w-11 place-items-center ${view === "grid" ? "text-black" : "text-zinc-500"}`}
                aria-label="Grid view"
                aria-pressed={view === "grid"}
              >
                <Grid2X2
                  className="h-5 w-5"
                  fill={view === "grid" ? "currentColor" : "none"}
                />
              </ActionButton>
              <ActionButton
                type="button"
                onClick={() => updateParams({ view: "list", page: 1 })}
                className={`grid h-11 w-11 place-items-center ${view === "list" ? "text-black" : "text-zinc-500"}`}
                aria-label="List view"
                aria-pressed={view === "list"}
              >
                <List className="h-6 w-6" />
              </ActionButton>
            </div>

            <div className="hidden items-center justify-center text-[0.72rem] uppercase text-zinc-600 md:flex">
              {total} {total === 1 ? "Product" : "Products"}
            </div>

            <div
              ref={sortContainerRef}
              className="relative md:border-l md:border-zinc-300"
            >
              <ActionButton
                type="button"
                ref={sortTriggerRef}
                onClick={() => setSortOpen((open) => !open)}
                className="flex h-full min-h-14 w-full items-center justify-center gap-2 px-4 text-[0.7rem] uppercase text-zinc-600"
                aria-expanded={sortOpen}
                aria-haspopup="listbox"
              >
                <span>{selectedSort.label}</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 motion-safe:transition-transform ${sortOpen ? "rotate-180" : ""}`}
                />
              </ActionButton>

              {sortOpen && (
                <div
                  className="absolute right-0 top-full z-40 max-h-[25rem] w-[min(19rem,100vw)] overflow-y-auto border border-zinc-300 bg-white py-2 shadow-lg"
                  role="listbox"
                  aria-label="Sort products"
                >
                  {SORT_OPTIONS.map((option) => (
                    <ActionButton
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSortOpen(false);
                        sortTriggerRef.current?.focus();
                        updateParams({ sort: option.value, page: 1 });
                      }}
                      className={`block w-full px-5 py-3 text-left text-sm transition-colors hover:bg-zinc-100 ${
                        option.value === sort ? "font-medium text-black" : "text-zinc-600"
                      }`}
                      role="option"
                      aria-selected={option.value === sort}
                    >
                      {option.label}
                    </ActionButton>
                  ))}
                </div>
              )}
            </div>
          </div>
          {isPending && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-zinc-500"
            />
          )}
        </div>
      )}

      {showPagination && pageCount > 1 && (
        <nav
          className="relative flex flex-wrap items-center justify-center gap-2 py-10"
          aria-label="Product pagination"
        >
          <ActionButton
            type="button"
            onClick={() => updateParams({ page: page - 1 }, true)}
            disabled={page <= 1}
            className="inline-flex h-11 items-center gap-1 border border-zinc-300 px-4 text-xs uppercase text-zinc-700 transition-colors hover:border-black hover:text-black disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </ActionButton>
          {pageNumbers.map((pageNumber) => (
            <ActionButton
              key={pageNumber}
              type="button"
              onClick={() => updateParams({ page: pageNumber }, true)}
              aria-current={pageNumber === page ? "page" : undefined}
              className={`h-11 w-11 border text-sm transition-colors ${
                pageNumber === page
                  ? "border-black bg-black text-white"
                  : "border-zinc-300 text-zinc-700 hover:border-black"
              }`}
            >
              {pageNumber}
            </ActionButton>
          ))}
          <ActionButton
            type="button"
            onClick={() => updateParams({ page: page + 1 }, true)}
            disabled={page >= pageCount}
            className="inline-flex h-11 items-center gap-1 border border-zinc-300 px-4 text-xs uppercase text-zinc-700 transition-colors hover:border-black hover:text-black disabled:cursor-not-allowed disabled:opacity-35"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </ActionButton>
          {isPending && (
            <p
              aria-hidden="true"
              className="absolute inset-x-2 bottom-2 text-center text-sm text-zinc-600"
            >
              Updating products…
            </p>
          )}
        </nav>
      )}
    </>
  );
}
