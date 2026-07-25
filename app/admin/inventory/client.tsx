"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Download, Plus, RotateCcw, Search, Trash2 } from "lucide-react";

import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";
import type { Category, Condition, ProductWithDetails } from "@/types/domain/product";

type StockStatus = "in_stock" | "archived";

type InventoryClientProps = {
  initialProducts: ProductWithDetails[];
  initialTotal: number;
  initialSkuTotal: number;
  initialInventoryUnitTotal: number;
  initialFilters: {
    q?: string;
    category?: Category | "all";
    condition?: Condition | "all";
    stockStatus?: StockStatus;
    page?: number;
  };
};

const PAGE_SIZE = 100;
const categories = ["all", "sneakers", "clothing", "accessories", "electronics"] as const;
const conditions = ["all", "new", "used"] as const;

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function InventoryClient({
  initialProducts,
  initialTotal,
  initialSkuTotal,
  initialInventoryUnitTotal,
  initialFilters,
}: InventoryClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialFilters.q ?? "");
  const [category, setCategory] = useState<Category | "all">(
    initialFilters.category ?? "all",
  );
  const [condition, setCondition] = useState<Condition | "all">(
    initialFilters.condition ?? "all",
  );
  const [stockStatus, setStockStatus] = useState<StockStatus>(
    initialFilters.stockStatus ?? "in_stock",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const page = initialFilters.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(initialTotal / PAGE_SIZE));

  const navigate = (nextPage = 1) => {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }
    if (category !== "all") {
      params.set("category", category);
    }
    if (condition !== "all") {
      params.set("condition", condition);
    }
    params.set("stockStatus", stockStatus);
    if (nextPage > 1) {
      params.set("page", String(nextPage));
    }
    router.push(`/admin/inventory?${params.toString()}`);
  };

  const runAction = async (
    product: ProductWithDetails,
    action: "archive" | "restore" | "delete",
  ) => {
    if (action === "delete" && !window.confirm(`Permanently delete ${product.name}?`)) {
      return;
    }
    setBusyId(product.id);
    setMessage(null);
    try {
      const endpoint =
        action === "delete"
          ? `/api/admin/products/${product.id}`
          : `/api/admin/products/${product.id}?action=${action}`;
      const response = await fetch(endpoint, {
        method: action === "delete" ? "DELETE" : "PATCH",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? `Failed to ${action} product`);
      }
      setMessage(`${product.name} ${action === "delete" ? "deleted" : `${action}d`}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inventory action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const exportInventory = () => {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }
    if (category !== "all") {
      params.set("category", category);
    }
    if (condition !== "all") {
      params.set("condition", condition);
    }
    params.set("stockStatus", stockStatus);
    window.location.assign(`/api/admin/products/export?${params.toString()}`);
  };

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Catalog"
        title="Inventory"
        description="Manage website products, variants, and available stock."
        actions={
          <>
            <button
              type="button"
              onClick={exportInventory}
              className="admin-button-secondary"
            >
              <Download className="h-4 w-4" /> Export
            </button>
            <Link href="/admin/inventory/create" className="admin-button-primary">
              <Plus className="h-4 w-4" /> Add product
            </Link>
          </>
        }
      />

      <div data-admin-metrics className="grid gap-3 sm:grid-cols-3">
        <Metric label="Products" value={initialTotal} />
        <Metric label="SKUs" value={initialSkuTotal} />
        <Metric label="Inventory units" value={initialInventoryUnitTotal} />
      </div>

      <form
        data-admin-toolbar
        onSubmit={(event) => {
          event.preventDefault();
          navigate();
        }}
        className="grid gap-3 border border-zinc-800 bg-zinc-900 p-4 md:grid-cols-[minmax(220px,1fr)_180px_160px_160px_auto]"
      >
        <label className="relative">
          <span className="sr-only">Search inventory</span>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or SKU"
            className="h-10 w-full border border-zinc-700 bg-black pl-10 pr-3 text-sm text-white outline-none focus:border-zinc-500"
          />
        </label>
        <FilterSelect
          value={category}
          onChange={(value) => setCategory(value as Category | "all")}
          label="Category"
          options={categories}
        />
        <FilterSelect
          value={condition}
          onChange={(value) => setCondition(value as Condition | "all")}
          label="Condition"
          options={conditions}
        />
        <FilterSelect
          value={stockStatus}
          onChange={(value) => setStockStatus(value as StockStatus)}
          label="Status"
          options={["in_stock", "archived"]}
        />
        <button
          type="submit"
          className="h-10 bg-white px-5 text-sm font-semibold text-black hover:bg-zinc-200"
        >
          Apply
        </button>
      </form>

      {message && (
        <div className="border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">
          {message}
        </div>
      )}

      <div className="overflow-hidden border border-zinc-800 bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Condition</th>
                <th className="px-4 py-3">SKUs</th>
                <th className="px-4 py-3">Stock</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {initialProducts.map((product) => {
                const primaryImage =
                  product.images.find((image) => image.is_primary) ?? product.images[0];
                const stock = product.variants.reduce(
                  (sum, variant) => sum + variant.stock,
                  0,
                );
                const prices = product.variants.map(
                  (variant) => variant.sale_price_cents,
                );
                const minimumPrice = prices.length ? Math.min(...prices) : 0;
                const busy = busyId === product.id;
                return (
                  <tr key={product.id} className="text-zinc-200">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-14 w-14 flex-none overflow-hidden bg-zinc-800">
                          {primaryImage?.url ? (
                            <Image
                              src={primaryImage.url}
                              alt=""
                              fill
                              sizes="56px"
                              className="object-cover"
                            />
                          ) : null}
                        </div>
                        <div>
                          <div className="max-w-xs font-medium text-white">
                            {product.name}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {product.variants[0]?.sku ?? "No SKU"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-zinc-400">
                      {product.category}
                    </td>
                    <td className="px-4 py-3 capitalize text-zinc-400">
                      {product.condition}
                    </td>
                    <td className="px-4 py-3">{product.variants.length}</td>
                    <td className="px-4 py-3">{stock}</td>
                    <td className="px-4 py-3">${(minimumPrice / 100).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/admin/inventory/${product.id}/edit`}
                          className="border border-zinc-700 px-3 py-2 text-xs hover:bg-zinc-800"
                        >
                          {product.archived_at ? "View" : "Edit"}
                        </Link>
                        {product.archived_at ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runAction(product, "restore")}
                            className="border border-zinc-700 p-2 hover:bg-zinc-800 disabled:opacity-50"
                            aria-label="Restore product"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runAction(product, "archive")}
                            className="border border-zinc-700 p-2 hover:bg-zinc-800 disabled:opacity-50"
                            aria-label="Archive product"
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runAction(product, "delete")}
                          className="border border-red-900/60 p-2 text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                          aria-label="Delete product"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {initialProducts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-zinc-500">
                    No products match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-400">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => navigate(page - 1)}
            className="border border-zinc-700 px-4 py-2 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => navigate(page + 1)}
            className="border border-zinc-700 px-4 py-2 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </AdminPage>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-zinc-800 bg-zinc-900 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: readonly string[];
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full border border-zinc-700 bg-black px-3 text-sm text-white outline-none focus:border-zinc-500"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? `All ${label.toLowerCase()}s` : titleCase(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
