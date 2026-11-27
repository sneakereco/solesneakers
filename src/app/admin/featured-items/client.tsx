// app/admin/featured-items/client.tsx
"use client";
import { adminCommand } from "@/components/admin/admin-command";

import { useAdminRead } from "@/components/admin/useAdminRead";
import { AdminReadStatus } from "@/components/admin/AdminSkeletons";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { useAsyncAction } from "@/components/ui/useAsyncAction";

import { useState, useEffect, useCallback } from "react";
import { Star, GripVertical, X, Plus } from "lucide-react";
import Image from "next/image";
import { FeedbackLink as Link } from "@/components/ui/FeedbackLink";

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

const loadFeatured = async (signal: AbortSignal) =>
  (
    await fetchJsonWithDeadline<{ items: FeaturedItem[] }>(
      "/api/admin/featured-items",
      "Featured items unavailable",
      signal,
    )
  ).items;
export function FeaturedItemsManager() {
  const read = useAdminRead(loadFeatured, "featured items");
  const command = useAsyncAction();
  const [draft, setFeaturedItems] = useState<FeaturedItem[] | null>(null);
  const featuredItems = draft ?? read.data ?? [];
  const blocked = command.pending || read.pending || !!read.error;
  const [progress, setProgress] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(searchQuery.trim()), 150);
    return () => clearTimeout(timeout);
  }, [searchQuery]);
  const find = useCallback(
    async (signal: AbortSignal) =>
      query
        ? (
            await fetchJsonWithDeadline<{ products: Product[] }>(
              `/api/admin/products?${new URLSearchParams({ limit: "20", includeOutOfStock: "1", q: query })}`,
              "Product search unavailable",
              signal,
            )
          ).products
        : [],
    [query],
  );
  const search = useAdminRead(find, "product search");
  const isSearching = query !== searchQuery.trim() || search.pending;
  const searchResults = isSearching ? [] : (search.data ?? []);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  } | null>(null);

  const run = (label: string, operation: () => Promise<void>) =>
    command.run(async () => {
      setProgress(label);
      try {
        await operation();
      } finally {
        setProgress("");
      }
    });
  const addFeaturedItem = async (productId: string) => {
    try {
      const { response, data } = await adminCommand<{ error?: string }>(
        "/api/admin/featured-items",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        },
      );

      if (!response.ok) {
        throw new Error(data?.error || "Failed to add featured item");
      }

      setToast({ message: "Product added to featured items", tone: "success" });
      setSearchQuery("");

      read.retry();
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
      const { response, data } = await adminCommand<{ error?: string }>(
        `/api/admin/featured-items?productId=${productId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error(data?.error || "Failed to remove featured item");
      }

      setToast({ message: "Product removed from featured items", tone: "success" });
      read.retry();
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

  const saveOrder = async (ordered: FeaturedItem[]) => {
    const updates = ordered.map((item, index) => ({
      id: item.id,
      sortOrder: index,
    }));

    try {
      const { response } = await adminCommand<unknown>(
        "/api/admin/featured-items/reorder",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to save order");
      }

      setToast({ message: "Order updated successfully", tone: "success" });
      read.retry();
    } catch (error) {
      logError(error, { layer: "frontend", event: "reorder_featured_items" });
      setToast({ message: "Failed to save order", tone: "error" });
      read.retry();
    } finally {
      setDraggedIndex(null);
      setFeaturedItems(null);
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

  return (
    <div className="space-y-6">
      <AdminReadStatus read={read} label="Loading featured items" />
      {progress && <p role="status">{progress}</p>}
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
            }}
            placeholder="Search products by name, brand, or SKU..."
            label="Search products"
          />
          {search.error && <AdminReadStatus read={search} label="Searching products" />}
          {searchQuery && isSearching && (
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
                    disabled={blocked}
                    onClick={() =>
                      void run("Adding featured item…", () => addFeaturedItem(product.id))
                    }
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
          !search.error &&
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

        {!read.data ? null : featuredItems.length === 0 ? (
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
                    draggable={!blocked}
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={() => {
                      if (draggedIndex !== null)
                        void run("Saving order…", () => saveOrder(featuredItems));
                    }}
                    className={[
                      "flex items-center gap-4 rounded border border-zinc-800/70 bg-zinc-800 p-4",
                      "cursor-move transition hover:border-zinc-700",
                      draggedIndex === index ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label={`Move ${item.product.name} up`}
                        disabled={blocked || index === 0}
                        onClick={() => {
                          const next = [...featuredItems];
                          [next[index - 1], next[index]] = [next[index], next[index - 1]];
                          void run("Saving order…", () => saveOrder(next));
                        }}
                        className="min-h-10 px-2"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${item.product.name} down`}
                        disabled={blocked || index === featuredItems.length - 1}
                        onClick={() => {
                          const next = [...featuredItems];
                          [next[index + 1], next[index]] = [next[index], next[index + 1]];
                          void run("Saving order…", () => saveOrder(next));
                        }}
                        className="min-h-10 px-2"
                      >
                        ↓
                      </button>
                    </div>
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
                      disabled={blocked}
                      onClick={() =>
                        void run("Removing featured item…", () =>
                          removeFeaturedItem(item.product_id),
                        )
                      }
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
