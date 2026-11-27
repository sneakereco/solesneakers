"use client";
import { adminCommand } from "@/components/admin/admin-command";

import { useState } from "react";
import { useAdminRead } from "@/components/admin/useAdminRead";
import { AdminReadStatus } from "@/components/admin/AdminSkeletons";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { ActionButton } from "@/components/ui/ActionButton";

import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";

import type { ActiveTab, Alias, Brand, Candidate, Model, TagSize } from "./types";

const tabs: Array<{ id: ActiveTab; label: string }> = [
  { id: "brands", label: "Brands" },
  { id: "models", label: "Models" },
  { id: "aliases", label: "Aliases" },
  { id: "candidates", label: "Candidates" },
  { id: "sizes", label: "Sizes" },
];

const inputClass =
  "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-black";
const buttonClass =
  "h-10 bg-white px-4 text-xs font-semibold uppercase tracking-wider text-black disabled:opacity-40";

async function loadTags(signal: AbortSignal) {
  const [brands, models, aliases, candidates, sizes] = await Promise.all([
    fetchJsonWithDeadline<{ brands: Brand[] }>(
      "/api/admin/tags/brands?includeInactive=1",
      "Tags unavailable",
      signal,
    ),
    fetchJsonWithDeadline<{ models: Model[] }>(
      "/api/admin/tags/models?includeInactive=1",
      "Tags unavailable",
      signal,
    ),
    fetchJsonWithDeadline<{ aliases: Alias[] }>(
      "/api/admin/tags/aliases?includeInactive=1",
      "Tags unavailable",
      signal,
    ),
    fetchJsonWithDeadline<{ candidates: Candidate[] }>(
      "/api/admin/tags/candidates?status=new",
      "Tags unavailable",
      signal,
    ),
    fetchJsonWithDeadline<{ sizes: TagSize[] }>(
      "/api/admin/tags/sizes?includeInactive=1",
      "Tags unavailable",
      signal,
    ),
  ]);
  return {
    brands: brands.brands,
    models: models.models,
    aliases: aliases.aliases,
    candidates: candidates.candidates,
    sizes: sizes.sizes,
  };
}
export default function TagsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("brands");
  const read = useAdminRead(loadTags, "tag vocabulary");
  const action = useAsyncAction();
  const disabled = action.pending || read.pending || !!read.error;
  const {
    brands = [],
    models = [],
    aliases = [],
    candidates = [],
    sizes = [],
  } = read.data ?? {};
  const [label, setLabel] = useState("");
  const [brandId, setBrandId] = useState("");
  const [entityType, setEntityType] = useState<"brand" | "model">("brand");
  const [entityId, setEntityId] = useState("");
  const [sizeType, setSizeType] = useState<TagSize["size_type"]>("shoe");
  const [message, setMessage] = useState("");
  const run = (operation: () => Promise<void>) =>
    action.run(async () => {
      setMessage("Saving tag…");
      try {
        await operation();
        setMessage("Tag saved.");
        read.retry();
      } catch {
        setMessage("Unable to save tag. Review your changes and retry.");
      }
    });
  const post = async (path: string, body: unknown) => {
    const { response } = await adminCommand<unknown>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error("Save failed");
    }
  };

  const patch = async (path: string, body: unknown) => {
    const { response } = await adminCommand<unknown>(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error("Update failed");
    }
  };

  const addCurrent = async () => {
    if (activeTab === "brands") {
      await post("/api/admin/tags/brands", { canonicalLabel: label });
    } else if (activeTab === "models") {
      await post("/api/admin/tags/models", { brandId, canonicalLabel: label });
    } else if (activeTab === "aliases") {
      await post("/api/admin/tags/aliases", {
        entityType,
        brandId: entityType === "brand" ? entityId : null,
        modelId: entityType === "model" ? entityId : null,
        aliasLabel: label,
      });
    } else if (activeTab === "sizes") {
      await post("/api/admin/tags/sizes", {
        sizeType,
        canonicalLabel: label,
        sortOrder: sizes.filter((size) => size.size_type === sizeType).length * 10,
      });
    }
    setLabel("");
  };

  const toggle = async (
    kind: "brands" | "models" | "aliases" | "sizes",
    item: { id: string; is_active: boolean },
  ) => patch(`/api/admin/tags/${kind}/${item.id}`, { isActive: !item.is_active });

  const acceptCandidate = async (candidate: Candidate) => {
    await post(`/api/admin/tags/candidates/${candidate.id}/accept`, {
      canonicalLabel: candidate.raw_text,
    });
  };

  const rejectCandidate = async (candidate: Candidate) => {
    const { response } = await adminCommand<unknown>(
      `/api/admin/tags/candidates/${candidate.id}/reject`,
      {
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error("Reject failed");
    }
  };

  const targetOptions = entityType === "brand" ? brands : models;
  const canAdd =
    label.trim().length > 0 &&
    (activeTab === "brands" ||
      activeTab === "sizes" ||
      (activeTab === "models" && Boolean(brandId)) ||
      (activeTab === "aliases" && Boolean(entityId)));

  return (
    <AdminPage width="content">
      <AdminPageHeader
        eyebrow="Catalog"
        title="Product tags"
        description="Manage canonical brands, models, aliases, candidates, and sizes used throughout the catalog."
      />
      <div
        data-admin-tabs
        className="flex gap-1 overflow-x-auto border-b border-white/10"
      >
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            disabled={action.pending}
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
            className={`px-4 py-3 text-xs uppercase tracking-wider ${
              activeTab === tab.id
                ? "border-b border-white text-white"
                : "text-white/45 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab !== "candidates" && (
        <div className="mb-8 grid gap-3 border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-[1fr_auto_auto]">
          <input
            disabled={action.pending}
            aria-label="New tag label"
            className={inputClass}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={`New ${activeTab.slice(0, -1)} label`}
          />
          {activeTab === "models" && (
            <select
              disabled={action.pending}
              aria-label="Brand"
              className={inputClass}
              value={brandId}
              onChange={(event) => setBrandId(event.target.value)}
            >
              <option value="">Select brand</option>
              {brands
                .filter((brand) => brand.is_active)
                .map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.canonical_label}
                  </option>
                ))}
            </select>
          )}
          {activeTab === "aliases" && (
            <div className="flex gap-2">
              <select
                disabled={action.pending}
                aria-label="Alias type"
                className={inputClass}
                value={entityType}
                onChange={(event) => {
                  setEntityType(event.target.value as "brand" | "model");
                  setEntityId("");
                }}
              >
                <option value="brand">Brand</option>
                <option value="model">Model</option>
              </select>
              <select
                disabled={action.pending}
                aria-label="Alias target"
                className={inputClass}
                value={entityId}
                onChange={(event) => setEntityId(event.target.value)}
              >
                <option value="">Select target</option>
                {targetOptions
                  .filter((item) => item.is_active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.canonical_label}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {activeTab === "sizes" && (
            <select
              disabled={action.pending}
              aria-label="Size type"
              className={inputClass}
              value={sizeType}
              onChange={(event) =>
                setSizeType(event.target.value as TagSize["size_type"])
              }
            >
              <option value="shoe">Shoe</option>
              <option value="clothing">Clothing</option>
              <option value="custom">Custom</option>
              <option value="none">None</option>
            </select>
          )}
          <ActionButton
            className={buttonClass}
            disabled={disabled || !canAdd}
            onClick={() => void run(addCurrent)}
          >
            Add
          </ActionButton>
        </div>
      )}
      {message && (
        <p role="status" className="mb-4 text-sm text-red-300">
          {message}
        </p>
      )}
      <AdminReadStatus read={read} label="Loading tags" />{" "}
      {read.data && (
        <div className="divide-y divide-white/10 border-y border-white/10">
          {activeTab === "brands" &&
            brands.map((item) => (
              <Row
                key={item.id}
                title={item.canonical_label}
                meta="Brand"
                active={item.is_active}
                disabled={disabled}
                onToggle={() => void run(() => toggle("brands", item))}
              />
            ))}
          {activeTab === "models" &&
            models.map((item) => (
              <Row
                key={item.id}
                title={item.canonical_label}
                meta={
                  brands.find((brand) => brand.id === item.brand_id)?.canonical_label ??
                  "Unknown brand"
                }
                active={item.is_active}
                disabled={disabled}
                onToggle={() => void run(() => toggle("models", item))}
              />
            ))}
          {activeTab === "aliases" &&
            aliases.map((item) => (
              <Row
                key={item.id}
                title={item.alias_label}
                meta={`${item.entity_type} alias`}
                active={item.is_active}
                disabled={disabled}
                onToggle={() => void run(() => toggle("aliases", item))}
              />
            ))}
          {activeTab === "sizes" &&
            sizes.map((item) => (
              <Row
                key={item.id}
                title={item.canonical_label}
                meta={`${item.size_type} / order ${item.sort_order}`}
                active={item.is_active}
                disabled={disabled}
                onToggle={() => void run(() => toggle("sizes", item))}
              />
            ))}
          {activeTab === "candidates" &&
            candidates.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="text-sm">{item.raw_text}</p>
                  <p className="mt-1 text-xs uppercase tracking-wider text-white/40">
                    {item.entity_type} candidate
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="border border-white/20 px-3 py-2 text-xs"
                    disabled={disabled}
                    onClick={() => void run(() => rejectCandidate(item))}
                  >
                    Reject
                  </button>
                  <button
                    className="bg-white px-3 py-2 text-xs text-black"
                    disabled={disabled}
                    onClick={() => void run(() => acceptCandidate(item))}
                  >
                    Accept
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </AdminPage>
  );
}

function Row({
  disabled,
  title,
  meta,
  active,
  onToggle,
}: {
  disabled: boolean;
  title: string;
  meta: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div>
        <p className="text-sm">{title}</p>
        <p className="mt-1 text-xs uppercase tracking-wider text-white/40">{meta}</p>
      </div>
      <button
        disabled={disabled}
        onClick={onToggle}
        className={`min-w-20 border px-3 py-2 text-xs ${active ? "border-emerald-400/30 text-emerald-300" : "border-white/15 text-white/40"}`}
      >
        {active ? "Active" : "Inactive"}
      </button>
    </div>
  );
}
