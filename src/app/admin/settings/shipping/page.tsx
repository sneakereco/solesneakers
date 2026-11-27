// app/admin/settings/shipping/page.tsx
"use client";
import { adminCommand } from "@/components/admin/admin-command";

import { useAdminRead } from "@/components/admin/useAdminRead";
import { AdminReadStatus } from "@/components/admin/AdminSkeletons";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { useId } from "react";

import { useMemo, useState } from "react";

import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";
import { CarrierSelector } from "@/components/admin/shipping/CarrierSelector";
import {
  parseStoredCarrierSelection,
  toggleCarrierSelection,
  type CarrierKey,
} from "@/lib/shipping/carriers";

import { ModalPortal } from "@/components/ui/ModalPortal";

const SHIPPING_CATEGORIES = [
  { key: "sneakers", label: "Sneakers" },
  { key: "clothing", label: "Clothing" },
  { key: "accessories", label: "Accessories" },
  { key: "electronics", label: "Electronics" },
];

type ShippingDefaultValues = {
  shipping_cost_cents: number;
  default_weight_oz: number;
  default_length_in: number;
  default_width_in: number;
  default_height_in: number;
};

const defaultPackage: ShippingDefaultValues = {
  shipping_cost_cents: 0,
  default_weight_oz: 16,
  default_length_in: 12,
  default_width_in: 12,
  default_height_in: 12,
};

const initialOrigin = {
  name: "",
  company: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "US",
};

type ShippingOriginAddress = typeof initialOrigin;

type OriginField = keyof ShippingOriginAddress;
type OriginErrors = Partial<Record<OriginField, string>>;

const moneyToCents = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned || cleaned === ".") {
    return 0;
  }

  const firstDot = cleaned.indexOf(".");
  let normalized = cleaned;

  if (firstDot !== -1) {
    const before = cleaned.slice(0, firstDot + 1);
    const after = cleaned.slice(firstDot + 1).replace(/\./g, "");
    normalized = before + after;
  }

  const [whole, frac = ""] = normalized.split(".");
  const wholeNum = Number(whole || "0");
  if (!Number.isFinite(wholeNum)) {
    return 0;
  }

  const centsStr = `${frac}00`.slice(0, 2);
  const centsNum = Number(centsStr || "0");
  if (!Number.isFinite(centsNum)) {
    return 0;
  }

  return wholeNum * 100 + centsNum;
};

const centsToMoneyString = (cents: number) => {
  const safe = Number.isFinite(cents) ? cents : 0;
  return (safe / 100).toFixed(2);
};

async function loadShippingSettings(signal: AbortSignal) {
  const [defaultsData, origin, carriers] = await Promise.all([
    fetchJsonWithDeadline<{ defaults: (ShippingDefaultValues & { category: string })[] }>(
      "/api/admin/shipping/defaults",
      "Defaults unavailable",
      signal,
    ),
    fetchJsonWithDeadline<{ origin: ShippingOriginAddress | null }>(
      "/api/admin/shipping/origin",
      "Origin unavailable",
      signal,
    ),
    fetchJsonWithDeadline<{ carriers: string[] }>(
      "/api/admin/shipping/carriers",
      "Carriers unavailable",
      signal,
    ),
  ]);
  const map: Record<string, ShippingDefaultValues> = {};
  for (const entry of defaultsData.defaults || []) {
    map[entry.category] = {
      shipping_cost_cents: entry.shipping_cost_cents ?? 0,
      default_weight_oz: entry.default_weight_oz ?? defaultPackage.default_weight_oz,
      default_length_in: entry.default_length_in ?? defaultPackage.default_length_in,
      default_width_in: entry.default_width_in ?? defaultPackage.default_width_in,
      default_height_in: entry.default_height_in ?? defaultPackage.default_height_in,
    };
  }

  return {
    map,
    origin: origin.origin ?? initialOrigin,
    carriers: parseStoredCarrierSelection(carriers.carriers),
  };
}
export default function ShippingSettingsPage() {
  const read = useAdminRead(loadShippingSettings, "shipping settings");
  return read.data ? (
    <ShippingSettings settings={read.data} />
  ) : (
    <AdminReadStatus read={read} shape="form" label="Loading shipping settings" />
  );
}
function ShippingSettings({
  settings,
}: {
  settings: Awaited<ReturnType<typeof loadShippingSettings>>;
}) {
  const id = useId();
  const defaultsAction = useAsyncAction();
  const originAction = useAsyncAction();
  const carriersAction = useAsyncAction();
  const [shippingDefaults, setShippingDefaults] = useState<
    Record<string, ShippingDefaultValues>
  >(settings.map);
  const [originAddress, setOriginAddress] = useState<ShippingOriginAddress>(
    settings.origin,
  );
  const [enabledCarriers, setEnabledCarriers] = useState<CarrierKey[]>(settings.carriers);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  const [isSavingOrigin, setIsSavingOrigin] = useState(false);
  const [isSavingCarriers, setIsSavingCarriers] = useState(false);
  const [message, setMessage] = useState("");
  const [originMessage, setOriginMessage] = useState("");
  const [originError, setOriginError] = useState("");
  const [originErrors, setOriginErrors] = useState<OriginErrors>({});
  const [carriersMessage, setCarriersMessage] = useState("");
  const [isDefaultsModalOpen, setIsDefaultsModalOpen] = useState(false);
  const [modalInvoker, setModalInvoker] = useState<HTMLButtonElement | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [defaultsDraft, setDefaultsDraft] = useState<ShippingDefaultValues | null>(null);

  // String versions for controlled inputs
  const [shippingCostInput, setShippingCostInput] = useState<string>("0.00");
  const [weightInput, setWeightInput] = useState<string>("16");
  const [lengthInput, setLengthInput] = useState<string>("12");
  const [widthInput, setWidthInput] = useState<string>("12");
  const [heightInput, setHeightInput] = useState<string>("12");

  const [isOriginModalOpen, setIsOriginModalOpen] = useState(false);
  const [originDraft, setOriginDraft] = useState<ShippingOriginAddress>(initialOrigin);

  const categoryMap = useMemo(
    () => new Map(SHIPPING_CATEGORIES.map((category) => [category.key, category.label])),
    [],
  );

  const extractOriginErrors = (
    issues: Record<string, { _errors?: string[] }> | undefined,
  ): OriginErrors => {
    const next: OriginErrors = {};
    if (!issues || typeof issues !== "object") {
      return next;
    }
    const fields: OriginField[] = [
      "name",
      "company",
      "phone",
      "line1",
      "line2",
      "city",
      "state",
      "postal_code",
      "country",
    ];
    fields.forEach((field) => {
      const entry = issues[field];
      if (entry?._errors?.length) {
        next[field] = entry._errors[0];
      }
    });
    return next;
  };

  const validateOriginDraft = (draft: ShippingOriginAddress): OriginErrors => {
    const errors: OriginErrors = {};
    const name = draft.name.trim();
    const company = (draft.company ?? "").trim();

    if (!name && !company) {
      errors.name = message;
      errors.company = message;
    }
    if (!draft.line1.trim()) {
      errors.line1 = "Street address is required.";
    }
    if (!draft.city.trim()) {
      errors.city = "City is required.";
    }
    if (!draft.state.trim()) {
      errors.state = "State is required.";
    }
    if (!draft.postal_code.trim()) {
      errors.postal_code = "ZIP / postal code is required.";
    }
    if (!draft.country.trim()) {
      errors.country = "Country is required.";
    }

    return errors;
  };

  const openDefaultsModal = (categoryKey: string, invoker: HTMLButtonElement) => {
    setModalInvoker(invoker);
    const current = shippingDefaults[categoryKey] ?? defaultPackage;
    setActiveCategory(categoryKey);
    setDefaultsDraft({ ...current });
    setShippingCostInput(centsToMoneyString(current.shipping_cost_cents));
    setWeightInput(String(current.default_weight_oz));
    setLengthInput(String(current.default_length_in));
    setWidthInput(String(current.default_width_in));
    setHeightInput(String(current.default_height_in));
    setIsDefaultsModalOpen(true);
    setMessage("");
  };

  const closeDefaultsModal = () => {
    setIsDefaultsModalOpen(false);
    setActiveCategory(null);
    setDefaultsDraft(null);
    setShippingCostInput("0.00");
    setWeightInput("16");
    setLengthInput("12");
    setWidthInput("12");
    setHeightInput("12");
  };

  const openOriginModal = (invoker: HTMLButtonElement) => {
    setModalInvoker(invoker);
    setOriginDraft({ ...originAddress });
    setIsOriginModalOpen(true);
    setOriginMessage("");
    setOriginError("");
    setOriginErrors({});
  };

  const handleDimensionInput = (
    field: "weight" | "length" | "width" | "height",
    value: string,
  ) => {
    const cleaned = value.replace(/[^\d.]/g, "");

    switch (field) {
      case "weight":
        setWeightInput(cleaned);
        break;
      case "length":
        setLengthInput(cleaned);
        break;
      case "width":
        setWidthInput(cleaned);
        break;
      case "height":
        setHeightInput(cleaned);
        break;
    }

    const numericValue = Number(cleaned);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      return;
    }

    setDefaultsDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const fieldMap = {
        weight: "default_weight_oz" as const,
        length: "default_length_in" as const,
        width: "default_width_in" as const,
        height: "default_height_in" as const,
      };
      return { ...prev, [fieldMap[field]]: numericValue };
    });
  };

  const handleShippingCostChange = (value: string) => {
    setShippingCostInput(value);
    const cents = moneyToCents(value);
    setDefaultsDraft((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, shipping_cost_cents: cents };
    });
  };

  const handleOriginDraftChange = (field: keyof ShippingOriginAddress, value: string) => {
    setOriginDraft((prev) => ({ ...prev, [field]: value }));
    if (originErrors[field]) {
      setOriginErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (originError) {
      setOriginError("");
    }
  };

  const toggleCarrier = (carrierKey: CarrierKey) => {
    setEnabledCarriers((previous) => toggleCarrierSelection(previous, carrierKey));
  };

  const saveDefaults = async () => {
    if (!activeCategory || !defaultsDraft) {
      return;
    }
    setIsSavingDefaults(true);
    setMessage("");

    const nextDefaults: Record<string, ShippingDefaultValues> = {
      ...shippingDefaults,
      [activeCategory]: defaultsDraft,
    };

    try {
      const defaults = SHIPPING_CATEGORIES.map((category) => ({
        category: category.key,
        shipping_cost_cents: Math.round(
          nextDefaults[category.key]?.shipping_cost_cents ?? 0,
        ),
        default_weight_oz:
          nextDefaults[category.key]?.default_weight_oz ??
          defaultPackage.default_weight_oz,
        default_length_in:
          nextDefaults[category.key]?.default_length_in ??
          defaultPackage.default_length_in,
        default_width_in:
          nextDefaults[category.key]?.default_width_in ?? defaultPackage.default_width_in,
        default_height_in:
          nextDefaults[category.key]?.default_height_in ??
          defaultPackage.default_height_in,
      }));

      const { response, data } = await adminCommand<{ error?: string }>(
        "/api/admin/shipping/defaults",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaults }),
        },
      );

      if (response.ok) {
        setShippingDefaults(nextDefaults);
        closeDefaultsModal();
        setMessage("Shipping defaults updated.");
      } else {
        setMessage(`Failed to update defaults: ${data?.error}`);
      }
    } catch {
      setMessage("An unexpected error occurred.");
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const saveOrigin = async () => {
    setIsSavingOrigin(true);
    setOriginMessage("");
    setOriginError("");
    setOriginErrors({});

    const draftErrors = validateOriginDraft(originDraft);
    if (Object.keys(draftErrors).length > 0) {
      setOriginErrors(draftErrors);
      setOriginError("Please fix the highlighted fields.");
      setIsSavingOrigin(false);
      return;
    }

    try {
      const { response, data } = await adminCommand<{
        origin?: ShippingOriginAddress;
        error?: string;
        issues?: Record<string, { _errors?: string[] }>;
      }>("/api/admin/shipping/origin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(originDraft),
      });
      if (response.ok) {
        setOriginAddress(data?.origin ?? originDraft);
        setIsOriginModalOpen(false);
        setOriginMessage("Shipping origin address saved.");
      } else {
        const fieldErrors = extractOriginErrors(data?.issues);
        if (Object.keys(fieldErrors).length > 0) {
          setOriginErrors(fieldErrors);
          setOriginError("Please fix the highlighted fields.");
          return;
        }
        setOriginError(data?.error || "Failed to save address.");
      }
    } catch {
      setOriginError("An unexpected error occurred.");
    } finally {
      setIsSavingOrigin(false);
    }
  };

  const saveCarriers = async () => {
    setIsSavingCarriers(true);
    setCarriersMessage("");
    try {
      const { response, data } = await adminCommand<{
        error?: string;
        carriers?: string[];
      }>("/api/admin/shipping/carriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carriers: enabledCarriers }),
      });

      if (response.ok) {
        setEnabledCarriers(
          parseStoredCarrierSelection(data?.carriers ?? enabledCarriers),
        );
        setCarriersMessage("Enabled carriers updated.");
      } else {
        setCarriersMessage(`Failed to save carriers: ${data?.error}`);
      }
    } catch {
      setCarriersMessage("An unexpected error occurred.");
    } finally {
      setIsSavingCarriers(false);
    }
  };

  const getPackageSummary = (categoryKey: string) => {
    const data = shippingDefaults[categoryKey] ?? defaultPackage;
    const cost = (data.shipping_cost_cents / 100).toFixed(2);
    return {
      cost,
      weight: data.default_weight_oz,
      length: data.default_length_in,
      width: data.default_width_in,
      height: data.default_height_in,
    };
  };

  const originLine = useMemo(() => {
    const parts = [
      originAddress.line1,
      originAddress.city,
      originAddress.state,
      originAddress.postal_code,
    ].filter(Boolean);
    return parts.join(", ");
  }, [originAddress]);

  const activeCategoryLabel = activeCategory
    ? (categoryMap.get(activeCategory) ?? "")
    : "";

  return (
    <AdminPage width="content">
      {originMessage && !isOriginModalOpen && <p role="status">{originMessage}</p>}
      <AdminPageHeader
        eyebrow="Settings"
        title="Shipping settings"
        description="Configure shipping defaults, origin addresses, and carrier options."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded border border-zinc-800/70 bg-zinc-900 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white sm:text-lg">
                Origin address
              </h2>
              <p className="text-xs text-gray-400 sm:text-sm">
                Used for labels and rate estimates.
              </p>
            </div>
            <button
              type="button"
              onClick={(event) => openOriginModal(event.currentTarget)}
              aria-haspopup="dialog"
              className="border border-zinc-800/70 bg-zinc-900 px-3 py-1.5 text-[12px] text-white hover:border-zinc-700 sm:px-4 sm:py-2 sm:text-sm"
            >
              Edit origin
            </button>
          </div>
          <div className="text-[12px] text-gray-400 sm:text-sm">
            {originLine ? originLine : "No origin address saved yet."}
          </div>
        </div>

        <div className="space-y-3 rounded border border-zinc-800/70 bg-zinc-900 p-5">
          <div>
            <h2 className="mb-2 text-base font-semibold text-white sm:text-lg">
              Enabled Carriers
            </h2>
            <p className="mb-4 text-xs text-gray-400 sm:text-sm">
              Select which carriers to offer for label creation.
            </p>
          </div>
          <CarrierSelector
            disabled={isSavingCarriers}
            enabled={enabledCarriers}
            onToggle={toggleCarrier}
          />
          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                void carriersAction.run(saveCarriers);
              }}
              disabled={isSavingCarriers}
              className="w-full rounded bg-red-600 px-4 py-2 text-[12px] text-white hover:bg-red-700 disabled:bg-gray-600 sm:text-sm"
            >
              {isSavingCarriers ? "Saving..." : "Save carriers"}
            </button>
            {carriersMessage && (
              <div className="mt-2 text-[12px] text-gray-400 sm:text-sm">
                <span role="status">{carriersMessage}</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded border border-zinc-800/70 bg-zinc-900 p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white sm:text-lg">
                Default packages
              </h2>
              <p className="text-xs text-gray-400 sm:text-sm">
                Configure default cost, weight, and dimensions per category.
              </p>
            </div>
            {!isDefaultsModalOpen && message && (
              <span role="status" className="text-[12px] text-gray-400 sm:text-sm">
                {message}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            {SHIPPING_CATEGORIES.map((category) => {
              const summary = getPackageSummary(category.key);
              return (
                <div
                  key={category.key}
                  className="rounded border border-zinc-800/70 bg-zinc-950/40 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 sm:text-xs">
                        {category.label}
                      </div>
                      <div className="mt-1 text-[12px] font-semibold text-white sm:text-base">
                        ${summary.cost} shipping
                      </div>
                      <div className="mt-2 text-[11px] text-gray-400 sm:text-xs">
                        {summary.length} x {summary.width} x {summary.height} in ·{" "}
                        {summary.weight} oz
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={(event) =>
                        openDefaultsModal(category.key, event.currentTarget)
                      }
                      className="border border-zinc-800/70 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:border-zinc-700 sm:py-2 sm:text-xs"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {isDefaultsModalOpen && defaultsDraft && (
        <ModalPortal
          open={isDefaultsModalOpen}
          invoker={modalInvoker}
          onClose={() => {
            if (!isSavingDefaults) closeDefaultsModal();
          }}
          label="Edit package defaults"
        >
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl space-y-5 overflow-y-auto rounded-lg border border-zinc-800/70 bg-zinc-900 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Edit package defaults
                </h3>
                <p className="text-xs text-gray-500">{activeCategoryLabel} defaults</p>
              </div>
              <button
                type="button"
                disabled={isSavingDefaults}
                onClick={closeDefaultsModal}
                className="min-h-11 px-2 text-gray-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
                  Package size
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label
                      htmlFor={`${id}-lengthInput`}
                      className="mb-1 block text-xs text-gray-400"
                    >
                      Length (in)
                    </label>
                    <input
                      disabled={isSavingDefaults || isSavingOrigin}
                      id={`${id}-lengthInput`}
                      type="text"
                      inputMode="numeric"
                      value={lengthInput}
                      onChange={(e) => handleDimensionInput("length", e.target.value)}
                      className="w-full border border-zinc-800/70 bg-zinc-900 px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${id}-widthInput`}
                      className="mb-1 block text-xs text-gray-400"
                    >
                      Width (in)
                    </label>
                    <input
                      disabled={isSavingDefaults || isSavingOrigin}
                      id={`${id}-widthInput`}
                      type="text"
                      inputMode="numeric"
                      value={widthInput}
                      onChange={(e) => handleDimensionInput("width", e.target.value)}
                      className="w-full border border-zinc-800/70 bg-zinc-900 px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${id}-heightInput`}
                      className="mb-1 block text-xs text-gray-400"
                    >
                      Height (in)
                    </label>
                    <input
                      disabled={isSavingDefaults || isSavingOrigin}
                      id={`${id}-heightInput`}
                      type="text"
                      inputMode="numeric"
                      value={heightInput}
                      onChange={(e) => handleDimensionInput("height", e.target.value)}
                      className="w-full border border-zinc-800/70 bg-zinc-900 px-3 py-2 text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${id}-weightInput`}
                    className="mb-1 block text-xs text-gray-400"
                  >
                    Weight (oz)
                  </label>
                  <input
                    disabled={isSavingDefaults || isSavingOrigin}
                    id={`${id}-weightInput`}
                    type="text"
                    inputMode="numeric"
                    value={weightInput}
                    onChange={(e) => handleDimensionInput("weight", e.target.value)}
                    className="w-full border border-zinc-800/70 bg-zinc-900 px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${id}-shippingCostInput`}
                    className="mb-1 block text-xs text-gray-400"
                  >
                    Shipping cost ($)
                  </label>
                  <input
                    disabled={isSavingDefaults || isSavingOrigin}
                    id={`${id}-shippingCostInput`}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={shippingCostInput}
                    onChange={(e) => handleShippingCostChange(e.target.value)}
                    onBlur={() =>
                      setShippingCostInput(
                        centsToMoneyString(defaultsDraft.shipping_cost_cents),
                      )
                    }
                    className="w-full border border-zinc-800/70 bg-zinc-900 px-3 py-2 text-white"
                  />
                </div>
              </div>
            </div>

            {message && (
              <p role="alert" className="px-4">
                {message}
              </p>
            )}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isSavingDefaults}
                onClick={closeDefaultsModal}
                className="rounded bg-zinc-800 px-4 py-2 text-white hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void defaultsAction.run(saveDefaults);
                }}
                disabled={isSavingDefaults}
                className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:bg-gray-600"
              >
                {isSavingDefaults ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {isOriginModalOpen && (
        <ModalPortal
          open={isOriginModalOpen}
          invoker={modalInvoker}
          onClose={() => {
            if (!isSavingOrigin) setIsOriginModalOpen(false);
          }}
          label="Edit origin"
        >
          <div className="w-full max-w-3xl rounded-sm border border-zinc-800/70 bg-zinc-950 p-3 sm:p-6">
            <div className="mb-2 flex items-center justify-between gap-3 sm:mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white sm:text-lg">
                  Edit origin
                </h2>
                <p className="hidden text-[12px] text-zinc-400 sm:block sm:text-sm">
                  Shipping origin address
                </p>
              </div>
              <button
                type="button"
                disabled={isSavingOrigin}
                onClick={() => setIsOriginModalOpen(false)}
                className="min-h-11 px-2 text-[11px] text-zinc-400 hover:text-white sm:text-sm"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] sm:gap-4 sm:text-sm md:grid-cols-2">
              <div className="col-span-2 text-[10px] text-zinc-400 sm:text-xs">
                Provide a contact name or company name. Phone number is optional.
              </div>
              <div>
                <label htmlFor={`${id}-name`} className="mb-0.5 block text-gray-400">
                  Contact name
                </label>
                <input
                  disabled={isSavingDefaults || isSavingOrigin}
                  id={`${id}-name`}
                  aria-invalid={Boolean(originErrors.name)}
                  aria-describedby={originErrors.name ? `${id}-name-error` : undefined}
                  type="text"
                  value={originDraft.name}
                  onChange={(e) => handleOriginDraftChange("name", e.target.value)}
                  className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                    originErrors.name ? "border-red-500" : "border-zinc-800/70"
                  }`}
                />
                {originErrors.name && (
                  <div id={`${id}-name-error`} className="mt-1 text-[10px] text-red-400">
                    {originErrors.name}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor={`${id}-company`} className="mb-0.5 block text-gray-400">
                  Company
                </label>
                <input
                  disabled={isSavingDefaults || isSavingOrigin}
                  id={`${id}-company`}
                  aria-invalid={Boolean(originErrors.company)}
                  aria-describedby={
                    originErrors.company ? `${id}-company-error` : undefined
                  }
                  type="text"
                  value={originDraft.company ?? ""}
                  onChange={(e) => handleOriginDraftChange("company", e.target.value)}
                  className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                    originErrors.company ? "border-red-500" : "border-zinc-800/70"
                  }`}
                />
                {originErrors.company && (
                  <div
                    id={`${id}-company-error`}
                    className="mt-1 text-[10px] text-red-400"
                  >
                    {originErrors.company}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor={`${id}-phone`} className="mb-0.5 block text-gray-400">
                  Phone number (optional)
                </label>
                <input
                  disabled={isSavingDefaults || isSavingOrigin}
                  id={`${id}-phone`}
                  aria-invalid={Boolean(originErrors.phone)}
                  aria-describedby={originErrors.phone ? `${id}-phone-error` : undefined}
                  type="text"
                  value={originDraft.phone ?? ""}
                  onChange={(e) => handleOriginDraftChange("phone", e.target.value)}
                  className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                    originErrors.phone ? "border-red-500" : "border-zinc-800/70"
                  }`}
                />
                {originErrors.phone && (
                  <div id={`${id}-phone-error`} className="mt-1 text-[10px] text-red-400">
                    {originErrors.phone}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor={`${id}-line1`} className="mb-0.5 block text-gray-400">
                  Street address
                </label>
                <input
                  disabled={isSavingDefaults || isSavingOrigin}
                  id={`${id}-line1`}
                  aria-invalid={Boolean(originErrors.line1)}
                  aria-describedby={originErrors.line1 ? `${id}-line1-error` : undefined}
                  type="text"
                  value={originDraft.line1}
                  onChange={(e) => handleOriginDraftChange("line1", e.target.value)}
                  className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                    originErrors.line1 ? "border-red-500" : "border-zinc-800/70"
                  }`}
                />
                {originErrors.line1 && (
                  <div id={`${id}-line1-error`} className="mt-1 text-[10px] text-red-400">
                    {originErrors.line1}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor={`${id}-line2`} className="mb-0.5 block text-gray-400">
                  Apartment, suite, etc.
                </label>
                <input
                  disabled={isSavingDefaults || isSavingOrigin}
                  id={`${id}-line2`}
                  aria-invalid={Boolean(originErrors.line2)}
                  aria-describedby={originErrors.line2 ? `${id}-line2-error` : undefined}
                  type="text"
                  value={originDraft.line2 ?? ""}
                  onChange={(e) => handleOriginDraftChange("line2", e.target.value)}
                  className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                    originErrors.line2 ? "border-red-500" : "border-zinc-800/70"
                  }`}
                />
                {originErrors.line2 && (
                  <div id={`${id}-line2-error`} className="mt-1 text-[10px] text-red-400">
                    {originErrors.line2}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor={`${id}-city`} className="mb-0.5 block text-gray-400">
                  City
                </label>
                <input
                  disabled={isSavingDefaults || isSavingOrigin}
                  id={`${id}-city`}
                  aria-invalid={Boolean(originErrors.city)}
                  aria-describedby={originErrors.city ? `${id}-city-error` : undefined}
                  type="text"
                  value={originDraft.city}
                  onChange={(e) => handleOriginDraftChange("city", e.target.value)}
                  className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                    originErrors.city ? "border-red-500" : "border-zinc-800/70"
                  }`}
                />
                {originErrors.city && (
                  <div id={`${id}-city-error`} className="mt-1 text-[10px] text-red-400">
                    {originErrors.city}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor={`${id}-state`} className="mb-0.5 block text-gray-400">
                  State
                </label>
                <input
                  disabled={isSavingDefaults || isSavingOrigin}
                  id={`${id}-state`}
                  aria-invalid={Boolean(originErrors.state)}
                  aria-describedby={originErrors.state ? `${id}-state-error` : undefined}
                  type="text"
                  value={originDraft.state}
                  onChange={(e) => handleOriginDraftChange("state", e.target.value)}
                  className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                    originErrors.state ? "border-red-500" : "border-zinc-800/70"
                  }`}
                />
                {originErrors.state && (
                  <div id={`${id}-state-error`} className="mt-1 text-[10px] text-red-400">
                    {originErrors.state}
                  </div>
                )}
              </div>
              <div>
                <label
                  htmlFor={`${id}-postal_code`}
                  className="mb-0.5 block text-gray-400"
                >
                  ZIP / Postal code
                </label>
                <input
                  disabled={isSavingDefaults || isSavingOrigin}
                  id={`${id}-postal_code`}
                  aria-invalid={Boolean(originErrors.postal_code)}
                  aria-describedby={
                    originErrors.postal_code ? `${id}-postal_code-error` : undefined
                  }
                  type="text"
                  value={originDraft.postal_code}
                  onChange={(e) => handleOriginDraftChange("postal_code", e.target.value)}
                  className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                    originErrors.postal_code ? "border-red-500" : "border-zinc-800/70"
                  }`}
                />
                {originErrors.postal_code && (
                  <div
                    id={`${id}-postal_code-error`}
                    className="mt-1 text-[10px] text-red-400"
                  >
                    {originErrors.postal_code}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor={`${id}-country`} className="mb-0.5 block text-gray-400">
                  Country
                </label>
                <input
                  disabled={isSavingDefaults || isSavingOrigin}
                  id={`${id}-country`}
                  aria-invalid={Boolean(originErrors.country)}
                  aria-describedby={
                    originErrors.country ? `${id}-country-error` : undefined
                  }
                  type="text"
                  value={originDraft.country}
                  onChange={(e) => handleOriginDraftChange("country", e.target.value)}
                  className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                    originErrors.country ? "border-red-500" : "border-zinc-800/70"
                  }`}
                />
                {originErrors.country && (
                  <div
                    id={`${id}-country-error`}
                    className="mt-1 text-[10px] text-red-400"
                  >
                    {originErrors.country}
                  </div>
                )}
              </div>
            </div>

            {(originError || originMessage) && (
              <div
                className={`mt-4 text-sm ${
                  originError ? "text-red-400" : "text-gray-400"
                }`}
              >
                {originError || originMessage}
              </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-2 sm:mt-6 sm:gap-3">
              <button
                type="button"
                disabled={isSavingOrigin}
                onClick={() => setIsOriginModalOpen(false)}
                className="border border-zinc-800/70 px-3 py-1.5 text-[11px] text-gray-300 sm:px-4 sm:py-2 sm:text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void originAction.run(saveOrigin);
                }}
                disabled={isSavingOrigin}
                className="bg-red-600 px-3 py-1.5 text-[11px] text-white hover:bg-red-500 disabled:bg-zinc-700 sm:px-4 sm:py-2 sm:text-sm"
              >
                {isSavingOrigin ? "Saving..." : "Save origin"}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </AdminPage>
  );
}
