// app/admin/featured-items/client.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, GripVertical, X, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { AdminSearchField } from "@/components/admin/AdminSearchField";
import { logError } from "@/lib/utils/log";
import { Toast } from "@/components/ui/Toast";

type FeaturedItem = {
  id: string;
  product_id: string;
  sort_order: number;
  product: {
    id: string;
    name: string;
    brand: string;
    model: string | null;
    category: string;
    is_active: boolean;
    is_out_of_stock: boolean;
    images?: Array<{
      url: string;
      is_primary: boolean;
      sort_order: number;
    }>;
    variants?: Array<{
      id: string;
      sale_price_cents: number;
      stock: number;
    }>;
  };
};

type Product = {
  id: string;
  name: string;
  brand: string;
  category: string;
  images: Array<{ url: string }>;
  variants: Array<{ sale_price_cents: number }>;
};

export function FeaturedItemsManager() {
  const [featuredItems, setFeaturedItems] = useState<FeaturedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  } | null>(null);

  const loadFeaturedItems = useCallback((signal?: AbortSignal) => {
    return fetch("/api/admin/featured-items", { signal })
      .then(async (response) => {
        const data = await response.json();
        if (signal?.aborted) return;
        if (response.ok) {
          setFeaturedItems(data.items || []);
        } else {
          throw new Error(data.error || "Failed to load featured items");
        }
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        logError(error, { layer: "frontend", event: "load_featured_items" });
        setToast({
          message:
            error instanceof Error ? error.message : "Failed to load featured items",
          tone: "error",
        });
      })
      .finally(() => {
        if (!signal?.aborted) setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadFeaturedItems(controller.signal);
    return () => controller.abort();
  }, [loadFeaturedItems]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length === 0) {
      return;
    }

    const controller = new AbortController();
    const searchProducts = async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({
          limit: "20",
          includeOutOfStock: "1",
        });
        params.set("q", query);

        const response = await fetch(`/api/admin/products?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "Failed to search products");
        }
        setSearchResults(data?.products || []);
      } catch (error: unknown) {
        const isAbort =
          error instanceof DOMException
            ? error.name === "AbortError"
            : typeof error === "object" &&
              error !== null &&
              "name" in error &&
              (error as { name?: string }).name === "AbortError";
        if (!isAbort) {
          setSearchResults([]);
          logError(error, { layer: "frontend", event: "featured_items_search" });
          setToast({
            message: error instanceof Error ? error.message : "Failed to search products",
            tone: "error",
          });
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    };

    const timeout = setTimeout(() => {
      void searchProducts();
    }, 150);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [searchQuery]);

  const addFeaturedItem = async (productId: string) => {
    try {
      const response = await fetch("/api/admin/featured-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to add featured item");
      }

      setToast({ message: "Product added to featured items", tone: "success" });
      setSearchQuery("");
      setSearchResults([]);
      setIsSearching(false);
      setIsLoading(true);
      await loadFeaturedItems();
    } catch (error) {
      logError(error, { layer: "frontend", event: "add_featured_item" });
      setToast({
        message: error instanceof Error ? error.message : "Failed to add featured item",
        tone: "error",
      });
    }
  };

  const removeFeaturedItem = async (productId: string) => {
    try {
      const response = await fetch(`/api/admin/featured-items?productId=${productId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove featured item");
      }

      setToast({ message: "Product removed from featured items", tone: "success" });
      setIsLoading(true);
      await loadFeaturedItems();
    } catch (error) {
      logError(error, { layer: "frontend", event: "remove_featured_item" });
      setToast({
        message:
          error instanceof Error ? error.message : "Failed to remove featured item",
        tone: "error",
      });
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) {
      return;
    }

    const newItems = [...featuredItems];
    const draggedItem = newItems[draggedIndex];
    newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, draggedItem);

    setFeaturedItems(newItems);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) {
      return;
    }

    const updates = featuredItems.map((item, index) => ({
      id: item.id,
      sortOrder: index,
    }));

    try {
      const response = await fetch("/api/admin/featured-items/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      if (!response.ok) {
        throw new Error("Failed to save order");
      }

      setToast({ message: "Order updated successfully", tone: "success" });
    } catch (error) {
      logError(error, { layer: "frontend", event: "reorder_featured_items" });
      setToast({ message: "Failed to save order", tone: "error" });
      setIsLoading(true);
      await loadFeaturedItems();
    } finally {
      setDraggedIndex(null);
    }
  };

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const getMinPrice = (variants?: Array<{ sale_price_cents: number }>) => {
    if (!variants || variants.length === 0) {
      return 0;
    }
    return Math.min(...variants.map((v) => v.sale_price_cents));
  };

  const featuredProductIds = new Set(featuredItems.map((item) => item.product_id));
  const filteredSearchResults = searchResults.filter(
    (product) => !featuredProductIds.has(product.id),
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-gray-400">Loading featured items...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add Products Section */}
      <section
        data-admin-section-card
        className="rounded border border-zinc-800/70 bg-zinc-900 p-6"
      >
        <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-white">
          <Plus className="h-5 w-5" />
          Add Products
        </h2>

        <div className="relative">
          <AdminSearchField
            value={searchQuery}
            onChange={(value) => {
              setSearchQuery(value);
              if (!value.trim()) {
                setSearchResults([]);
                setIsSearching(false);
              }
            }}
            placeholder="Search products by name, brand, or SKU..."
            label="Search products"
          />
          {isSearching && (
            <div className="pointer-events-none absolute right-11 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
              Searching...
            </div>
          )}

          {filteredSearchResults.length > 0 && (
            <div className="absolute z-10 mt-2 max-h-96 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
              {filteredSearchResults.map((product) => {
                const minPrice = getMinPrice(product.variants);
                const primaryImage = product.images?.[0]?.url;

                return (
                  <button
                    key={product.id}
                    onClick={() => void addFeaturedItem(product.id)}
                    className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-zinc-700"
                  >
                    {primaryImage ? (
                      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-zinc-900">
                        <Image
                          src={primaryImage}
                          alt={product.name}
                          fill
                          className="object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded bg-zinc-900">
                        <span className="text-xs text-gray-500">No image</span>
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-white">
                        {product.name}
                      </div>
                      <div className="truncate text-sm text-gray-400">
                        {product.category} • {formatPrice(minPrice)}
                      </div>
                    </div>

                    <Plus className="h-5 w-5 flex-shrink-0 text-red-500" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {searchQuery.trim().length > 0 &&
          filteredSearchResults.length === 0 &&
          !isSearching && (
            <div className="mt-4 text-center text-sm text-gray-400">
              No products found matching &quot;{searchQuery}&quot;
            </div>
          )}
      </section>

      {/* Featured Items List */}
      <section
        data-admin-section-card
        className="rounded border border-zinc-800/70 bg-zinc-900 p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Star className="h-5 w-5 text-yellow-500" />
            Featured Items ({featuredItems.length})
          </h2>
          <Link
            href="/"
            target="_blank"
            className="text-sm text-gray-400 transition hover:text-white"
          >
            View on home page →
          </Link>
        </div>

        {featuredItems.length === 0 ? (
          <div className="py-12 text-center">
            <Star className="mx-auto mb-4 h-12 w-12 text-gray-600" />
            <p className="mb-2 text-lg text-gray-400">No featured items yet</p>
            <p className="text-sm text-gray-500">
              Search for products above to add them to the featured section
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 text-sm text-gray-400">
              Drag items to reorder. Items appear left-to-right on the home page.
            </div>

            <div className="space-y-3">
              {featuredItems.map((item, index) => {
                const primaryImage =
                  item.product.images?.find((img) => img.is_primary)?.url ||
                  item.product.images?.[0]?.url;
                const minPrice = getMinPrice(item.product.variants);

                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={() => void handleDragEnd()}
                    className={[
                      "flex items-center gap-4 rounded border border-zinc-800/70 bg-zinc-800 p-4",
                      "cursor-move transition hover:border-zinc-700",
                      draggedIndex === index ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    <GripVertical className="h-5 w-5 flex-shrink-0 text-gray-500" />

                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-zinc-700">
                      <span className="text-sm font-semibold text-gray-300">
                        {index + 1}
                      </span>
                    </div>

                    {primaryImage ? (
                      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-zinc-900">
                        <Image
                          src={primaryImage}
                          alt={item.product.name}
                          fill
                          className="object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded bg-zinc-900">
                        <span className="text-xs text-gray-500">No image</span>
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-white">
                        {item.product.name}
                      </div>
                      <div className="truncate text-sm text-gray-400">
                        {item.product.category} • {formatPrice(minPrice)}
                      </div>
                      {item.product.is_out_of_stock && (
                        <div className="mt-1 text-xs text-red-400">
                          Out of stock (hidden on home page)
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => void removeFeaturedItem(item.product_id)}
                      className="flex-shrink-0 rounded p-2 transition hover:bg-zinc-700"
                      title="Remove from featured"
                    >
                      <X className="h-5 w-5 text-red-500" />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <Toast
        open={Boolean(toast)}
        message={toast?.message ?? ""}
        tone={toast?.tone ?? "info"}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
