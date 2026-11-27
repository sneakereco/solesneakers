"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { StoreOverlayLink as FeedbackLink } from "@/components/shell/StoreOverlayLink";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { LoadingAnnouncement } from "@/components/ui/LoadingAnnouncement";
import { RequestError } from "@/components/ui/RequestError";
import { LoadingState, Skeleton } from "@/components/ui/Skeleton";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { logError } from "@/lib/utils/log";
import { captureCatalogSearchResults } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/triggers";
import { useViewGrant } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/view-grant";

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch?: (href: string) => void;
  invoker?: HTMLElement | null;
}

type SearchResult = {
  id: string;
  name: string;
  brand?: { id: string; label: string } | null;
  model?: { id: string; label: string } | null;
  condition?: string | null;
  images?: Array<{
    url?: string | null;
    is_primary?: boolean | null;
    sort_order?: number | null;
  }> | null;
  variants?: Array<{
    sale_price_cents?: number | null;
    stock?: number | null;
  }> | null;
};

type SearchResponse = {
  products?: SearchResult[];
  total?: number;
};

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const SEARCH_EXIT_DURATION_MS = 180;
const SEARCH_ERROR = "Search is temporarily unavailable. Please try again.";
const searchHref = (query: string) => `/store?q=${encodeURIComponent(query)}`;

function getProductImage(product: SearchResult) {
  const images = product.images ?? [];
  return (
    images.find((image) => image.is_primary)?.url ??
    images
      .slice()
      .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0))
      .find((image) => image.url)?.url ??
    null
  );
}

function getProductPrice(product: SearchResult) {
  const prices = (product.variants ?? [])
    .filter((variant) => Number(variant.stock ?? 0) > 0)
    .map((variant) => Number(variant.sale_price_cents))
    .filter((price) => Number.isFinite(price) && price >= 0);

  if (prices.length === 0) {
    return null;
  }

  return priceFormatter.format(Math.min(...prices) / 100);
}

function getConditionLabel(condition?: string | null) {
  if (condition === "used") {
    return "Pre-owned";
  }
  if (condition === "new") {
    return "New";
  }
  return null;
}

function buildSuggestions(results: SearchResult[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const suggestions = new Map<string, string>();
  const addSuggestion = (value?: string | null) => {
    const trimmed = value?.trim();
    if (!trimmed || !trimmed.toLowerCase().includes(normalizedQuery)) {
      return;
    }
    suggestions.set(trimmed.toLowerCase(), trimmed);
  };

  for (const product of results) {
    addSuggestion(product.brand?.label);
    addSuggestion(product.model?.label);

    for (const word of product.name.split(/\s+/)) {
      const cleaned = word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
      if (cleaned.length > 2) {
        addSuggestion(cleaned);
      }
    }
  }

  return Array.from(suggestions.values()).slice(0, 6);
}

export function SearchOverlay({
  isOpen,
  onClose,
  invoker,
  onSearch,
}: SearchOverlayProps) {
  const router = useRouter();
  const grant = useViewGrant();
  const currentGrant = useRef(grant);
  useEffect(() => {
    currentGrant.current = grant;
  }, [grant]);
  const requestGeneration = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{
    query: string;
    products: SearchResult[];
    total: number;
  } | null>(null);
  const [settled, setSettled] = useState<{
    query: string;
    attempt: number;
    failed: boolean;
  } | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const normalizedQuery = query.trim();
  const isCurrent = settled?.query === normalizedQuery && settled.attempt === attempt;
  const isLoading = Boolean(normalizedQuery) && !isCurrent;
  const searchError = isCurrent && settled.failed;
  const previous = response !== null && response.query !== normalizedQuery;
  const suggestions = useMemo(
    () =>
      response?.query === normalizedQuery
        ? buildSuggestions(response.products, normalizedQuery)
        : [],
    [normalizedQuery, response],
  );

  const closeSearch = useCallback(() => {
    if (closeTimerRef.current !== null) {
      return;
    }

    requestGeneration.current += 1;
    setIsClosing(true);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    closeTimerRef.current = window.setTimeout(
      () => {
        setQuery("");
        setResponse(null);
        setSettled(null);
        setIsClosing(false);
        closeTimerRef.current = null;
        onClose();
      },
      reducedMotion ? 0 : SEARCH_EXIT_DURATION_MS,
    );
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen || isClosing || !normalizedQuery) return;

    const originalGrant = currentGrant.current;
    const controller = new AbortController();
    const generation = requestGeneration.current;
    const stillOwned = () =>
      !controller.signal.aborted && generation === requestGeneration.current;
    const runSearch = async () => {
      try {
        const data = await fetchJsonWithDeadline<SearchResponse | null>(
          `/api/store/products?q=${encodeURIComponent(normalizedQuery)}&limit=6`,
          SEARCH_ERROR,
          controller.signal,
        );
        if (!stillOwned()) return;
        if (
          !Array.isArray(data?.products) ||
          data.products.some(
            (product) =>
              !product ||
              typeof product.id !== "string" ||
              typeof product.name !== "string",
          )
        )
          throw new Error("Invalid search results");
        if (
          originalGrant &&
          currentGrant.current === originalGrant &&
          typeof data.total === "number"
        ) {
          captureCatalogSearchResults(data.total, normalizedQuery, data.products);
        }
        setResponse({
          query: normalizedQuery,
          products: data.products,
          total: Number(data.total ?? data.products.length),
        });
        setSettled({ query: normalizedQuery, attempt, failed: false });
      } catch (error) {
        if (!stillOwned()) return;
        setSettled({ query: normalizedQuery, attempt, failed: true });
        logError(error, { layer: "frontend", event: "search_overlay_error" });
      }
    };
    const timer = window.setTimeout(() => void runSearch(), 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, isClosing, isOpen, normalizedQuery]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalizedQuery) return;
    const href = searchHref(normalizedQuery);
    if (onSearch) onSearch(href);
    else router.push(href);
    closeSearch();
  };

  if (!isOpen) {
    return null;
  }

  const showResultsPanel = Boolean(normalizedQuery);
  const results = response?.products ?? [];
  const hasResults = results.length > 0;
  const showSuggestions = !isLoading && !searchError && suggestions.length > 0;

  return (
    <ModalPortal
      open={isOpen}
      invoker={invoker}
      onClose={closeSearch}
      label="Search products"
      initialFocusRef={inputRef}
      zIndexClassName="z-[60]"
      contentClassName="contents"
      backdropClassName={`search-overlay-backdrop bg-black/40 !top-[var(--rdk-header-offset,8rem)] ${
        isClosing ? "search-overlay-backdrop--closing" : ""
      }`}
    >
      <div
        inert={isClosing}
        className={`search-drop-panel absolute inset-x-0 top-[var(--rdk-header-offset,8rem)] ${
          isClosing ? "search-drop-panel--closing" : ""
        }`}
      >
        <form
          onSubmit={handleSubmit}
          className="flex h-20 items-center border-y border-zinc-300 bg-[#f7f7f5] px-5 text-black sm:h-24 sm:px-10 lg:px-[3.75rem]"
          role="search"
        >
          <Search className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" strokeWidth={1.6} />
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (nextQuery.trim() !== normalizedQuery) {
                requestGeneration.current += 1;
                setSettled(null);
              }
              if (!nextQuery.trim()) setResponse(null);
            }}
            placeholder="SEARCH FOR..."
            className="mx-5 min-w-0 flex-1 bg-transparent text-lg font-normal uppercase text-zinc-800 placeholder:text-zinc-500 focus:outline-none sm:mx-7 sm:text-[1.35rem]"
            aria-label="Search for products"
            autoComplete="off"
          />
          <ActionButton
            type="button"
            onClick={closeSearch}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-900 transition-colors hover:text-zinc-500"
            aria-label="Close search"
          >
            <X className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={1.5} />
          </ActionButton>
        </form>

        {showResultsPanel ? (
          <section
            className="mx-auto flex w-[calc(100%-2rem)] flex-col border border-zinc-200 bg-white text-black shadow-[0_2px_12px_rgba(0,0,0,0.16)] sm:w-[88.6%]"
            style={{
              height: "calc(100vh - var(--rdk-header-offset, 8rem) - 7rem)",
            }}
            aria-label="Search results"
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div
                className={
                  showSuggestions
                    ? "grid h-full lg:grid-cols-[minmax(0,2.15fr)_minmax(15rem,1fr)]"
                    : "h-full"
                }
              >
                <div className="min-w-0 px-4 py-4 sm:px-5">
                  <div className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-4 text-[0.7rem] uppercase tracking-[0.03em] text-zinc-500">
                    <span>
                      {previous && hasResults ? "Previous matches" : "Product matches"}
                    </span>
                    {isLoading && hasResults && <span aria-hidden="true">Updating…</span>}
                  </div>

                  {searchError && (
                    <div className="px-4 py-6">
                      <RequestError
                        message={SEARCH_ERROR}
                        onRetry={() => {
                          requestGeneration.current += 1;
                          setAttempt((value) => value + 1);
                          inputRef.current?.focus();
                        }}
                      />
                    </div>
                  )}
                  {isLoading && hasResults && (
                    <LoadingAnnouncement label="Updating product matches" />
                  )}
                  {isLoading && !hasResults ? (
                    <LoadingState
                      label="Searching products"
                      className="grid gap-x-8 sm:grid-cols-2"
                    >
                      {Array.from({ length: 4 }, (_, index) => (
                        <div
                          key={index}
                          aria-hidden="true"
                          className="grid min-h-[7.25rem] grid-cols-[5rem_minmax(0,1fr)] items-center gap-4 border-b border-zinc-100 py-4"
                        >
                          <Skeleton className="h-16 w-20" />
                          <div className="space-y-3">
                            <Skeleton className="h-3 w-4/5" />
                            <Skeleton className="h-3 w-2/5" />
                          </div>
                        </div>
                      ))}
                    </LoadingState>
                  ) : hasResults ? (
                    <div
                      className="grid gap-x-8 sm:grid-cols-2"
                      aria-busy={isLoading || undefined}
                    >
                      {results.map((product) => {
                        const imageUrl = getProductImage(product);
                        const price = getProductPrice(product);
                        const condition = getConditionLabel(product.condition);

                        return (
                          <FeedbackLink
                            key={product.id}
                            href={`/store/${product.id}`}
                            onNavigate={closeSearch}
                            className="group grid min-h-[7.25rem] grid-cols-[5rem_minmax(0,1fr)] items-center gap-4 border-b border-zinc-100 py-4 text-left"
                          >
                            <div className="relative h-16 w-20 overflow-hidden bg-zinc-50">
                              {imageUrl ? (
                                <Image
                                  src={imageUrl}
                                  alt={product.name}
                                  fill
                                  sizes="80px"
                                  className="object-contain"
                                />
                              ) : null}
                            </div>
                            <div className="min-w-0">
                              <div className="line-clamp-2 text-[0.95rem] leading-5 text-zinc-700 transition-colors group-hover:text-black">
                                {product.name}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-2 text-sm text-zinc-400">
                                {product.brand ? (
                                  <span>{product.brand.label}</span>
                                ) : null}
                                {condition ? <span>{condition}</span> : null}
                              </div>
                              <div className="mt-2 text-[0.95rem] text-zinc-600">
                                {price ?? "Price unavailable"}
                              </div>
                            </div>
                          </FeedbackLink>
                        );
                      })}
                    </div>
                  ) : !searchError ? (
                    <div
                      role="status"
                      className="px-4 py-14 text-center text-sm text-zinc-600"
                    >
                      No products found for &quot;{normalizedQuery}&quot;.
                    </div>
                  ) : null}
                </div>

                {showSuggestions ? (
                  <aside className="border-t border-zinc-200 px-5 py-4 lg:border-l lg:border-t-0">
                    <div className="mb-5 text-[0.7rem] uppercase tracking-[0.03em] text-zinc-400">
                      Search suggestions
                    </div>
                    <div className="flex flex-col items-start gap-4">
                      {suggestions.map((suggestion) => (
                        <FeedbackLink
                          key={suggestion.toLowerCase()}
                          href={searchHref(suggestion)}
                          onNavigate={closeSearch}
                          className="text-sm text-zinc-600 transition-colors hover:text-black"
                        >
                          {suggestion}
                        </FeedbackLink>
                      ))}
                    </div>
                  </aside>
                ) : null}
              </div>
            </div>

            {!isLoading && !searchError ? (
              <FeedbackLink
                href={searchHref(normalizedQuery)}
                onNavigate={closeSearch}
                className="shrink-0 border-t border-zinc-200 bg-white px-5 py-3 text-center text-xs text-zinc-500 transition-colors hover:text-black"
              >
                View all {response && response.total > 0 ? `${response.total} ` : ""}
                results for{" "}
                <span className="font-semibold text-zinc-800">{normalizedQuery}</span>
              </FeedbackLink>
            ) : null}
          </section>
        ) : null}
      </div>
    </ModalPortal>
  );
}
