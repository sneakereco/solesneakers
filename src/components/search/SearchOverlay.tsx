"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { logError } from "@/lib/utils/log";

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
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

export function SearchOverlay({ isOpen, onClose }: SearchOverlayProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const normalizedQuery = query.trim();
  const suggestions = useMemo(
    () => buildSuggestions(results, normalizedQuery),
    [normalizedQuery, results],
  );

  const closeSearch = () => {
    setQuery("");
    setResults([]);
    setTotal(0);
    setIsLoading(false);
    setSearchError(null);
    onClose();
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuery("");
        setResults([]);
        setTotal(0);
        setIsLoading(false);
        setSearchError(null);
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !normalizedQuery) {
      return;
    }

    const controller = new AbortController();
    const runSearch = async () => {
      setIsLoading(true);
      setSearchError(null);

      try {
        const response = await fetch(
          `/api/store/products?q=${encodeURIComponent(normalizedQuery)}&limit=6`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`Search request failed with status ${response.status}`);
        }

        const data = (await response.json()) as SearchResponse;
        startTransition(() => {
          setResults(data.products ?? []);
          setTotal(Number(data.total ?? data.products?.length ?? 0));
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setResults([]);
        setTotal(0);
        setSearchError("Search is temporarily unavailable. Please try again.");
        logError(error, { layer: "frontend", event: "search_overlay_error" });
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };
    const timer = window.setTimeout(() => void runSearch(), 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, normalizedQuery]);

  const openSearchResults = (searchQuery: string) => {
    const value = searchQuery.trim();
    if (!value) {
      return;
    }
    router.push(`/store?q=${encodeURIComponent(value)}`);
    closeSearch();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    openSearchResults(normalizedQuery);
  };

  if (!isOpen) {
    return null;
  }

  const showResultsPanel = Boolean(normalizedQuery);
  const hasResults = results.length > 0;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[60]"
      style={{ top: "var(--rdk-header-offset, 8rem)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Search products"
    >
      <button
        type="button"
        className="search-overlay-backdrop absolute inset-0 bg-black/40"
        onClick={closeSearch}
        aria-label="Close search"
      />

      <div className="search-drop-panel relative">
        <form
          onSubmit={handleSubmit}
          className="flex h-20 items-center border-b border-zinc-300 bg-[#f7f7f5] px-5 text-black sm:h-24 sm:px-10 lg:px-[3.75rem]"
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
              setResults([]);
              setTotal(0);
              setSearchError(null);
              setIsLoading(Boolean(nextQuery.trim()));
            }}
            placeholder="SEARCH FOR..."
            className="mx-5 min-w-0 flex-1 bg-transparent text-lg font-normal uppercase text-zinc-800 placeholder:text-zinc-500 focus:outline-none sm:mx-7 sm:text-[1.35rem]"
            aria-label="Search for products"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={closeSearch}
            className="flex h-10 w-10 shrink-0 items-center justify-center text-zinc-900 transition-colors hover:text-zinc-500"
            aria-label="Close search"
          >
            <X className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={1.5} />
          </button>
        </form>

        {showResultsPanel ? (
          <section
            className="mx-auto flex w-[calc(100%-2rem)] flex-col border border-zinc-200 bg-white text-black shadow-[0_2px_12px_rgba(0,0,0,0.16)] sm:w-[88.6%]"
            style={{
              height: "calc(100vh - var(--rdk-header-offset, 8rem) - 7rem)",
            }}
            aria-live="polite"
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div
                className={
                  suggestions.length > 0
                    ? "grid h-full lg:grid-cols-[minmax(0,2.15fr)_minmax(15rem,1fr)]"
                    : "h-full"
                }
              >
                <div className="min-w-0 px-4 py-4 sm:px-5">
                  <div className="border-b border-zinc-100 pb-4 text-[0.7rem] uppercase tracking-[0.03em] text-zinc-400">
                    Product matches
                  </div>

                  {isLoading ? (
                    <div className="grid gap-x-8 sm:grid-cols-2" aria-label="Searching">
                      {Array.from({ length: 4 }, (_, index) => (
                        <div
                          key={index}
                          className="flex animate-pulse items-center gap-4 border-b border-zinc-100 py-5"
                        >
                          <div className="h-16 w-20 bg-zinc-100" />
                          <div className="flex-1 space-y-3">
                            <div className="h-3 w-4/5 bg-zinc-100" />
                            <div className="h-3 w-2/5 bg-zinc-100" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : searchError ? (
                    <div className="px-4 py-14 text-center text-sm text-zinc-600">
                      {searchError}
                    </div>
                  ) : hasResults ? (
                    <div className="grid gap-x-8 sm:grid-cols-2">
                      {results.map((product) => {
                        const imageUrl = getProductImage(product);
                        const price = getProductPrice(product);
                        const condition = getConditionLabel(product.condition);

                        return (
                          <Link
                            key={product.id}
                            href={`/store/${product.id}`}
                            onClick={closeSearch}
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
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-14 text-center text-sm text-zinc-600">
                      No products found for &quot;{normalizedQuery}&quot;.
                    </div>
                  )}
                </div>

                {suggestions.length > 0 && !isLoading ? (
                  <aside className="border-t border-zinc-200 px-5 py-4 lg:border-l lg:border-t-0">
                    <div className="mb-5 text-[0.7rem] uppercase tracking-[0.03em] text-zinc-400">
                      Search suggestions
                    </div>
                    <div className="flex flex-col items-start gap-4">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion.toLowerCase()}
                          type="button"
                          onClick={() => openSearchResults(suggestion)}
                          className="text-sm text-zinc-600 transition-colors hover:text-black"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </aside>
                ) : null}
              </div>
            </div>

            {!isLoading && !searchError ? (
              <button
                type="button"
                onClick={() => openSearchResults(normalizedQuery)}
                className="shrink-0 border-t border-zinc-200 bg-white px-5 py-3 text-center text-xs text-zinc-500 transition-colors hover:text-black"
              >
                View all {total > 0 ? `${total} ` : ""}results for{" "}
                <span className="font-semibold text-zinc-800">{normalizedQuery}</span>
              </button>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
