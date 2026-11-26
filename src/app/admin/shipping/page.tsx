// app/admin/shipping/page.tsx
"use client";
import { useAdminOrderQueue } from "@/components/admin/useAdminOrderQueue";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { adminCommand } from "@/components/admin/admin-command";
import { useAdminRead } from "@/components/admin/useAdminRead";
import { AdminReadStatus } from "@/components/admin/AdminSkeletons";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";

import Image from "next/image";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, AlertCircle } from "lucide-react";

import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";
import {
  AdminOrderItemDetailsModal,
  getOrderItemFinancials,
  type AdminOrderItem,
} from "@/components/admin/orders/OrderItemDetailsModal";
import { logError } from "@/lib/utils/log";
import { buildPackageProfile } from "@/lib/shipping/package-profile";
import { CreateLabelForm } from "@/components/admin/shipping/CreateLabelForm";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

import { OriginModal } from "@/components/admin/shipping/OriginModal";
import type {
  ShippingAddress,
  ShippingDefault,
  ShippingOrigin,
  TabKey,
} from "@/types/domain/shipping";

const PAGE_SIZE = 8;
const DEFAULT_PACKAGE = { weight: 16, length: 12, width: 12, height: 12 };
const SHIPPING_ORDER_STATUSES = ["paid", "shipped"];
const EMPTY_ORIGIN: ShippingOrigin = {
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

type OriginField = keyof ShippingOrigin;
type OriginErrors = Partial<Record<OriginField, string>>;

const TABS: Array<{ key: TabKey; label: string; status: string }> = [
  { key: "label", label: "Review & Create Label", status: "unfulfilled" },
  { key: "ready", label: "Need to Ship", status: "ready_to_ship" },
  { key: "shipped", label: "Shipped", status: "shipped" },
  { key: "delivered", label: "Delivered", status: "delivered" },
];

type OrderItem = AdminOrderItem;

type ShippingOrder = {
  id: string;
  created_at?: string | null;
  shipping?: unknown;
  user_id?: string | null;
  shipping_profile_name?: string | null;
  items?: OrderItem[] | null;
  shipping_carrier?: string | null;
  tracking_number?: string | null;
  label_url?: string | null;
};

const getTrackingUrl = (carrier?: string | null, trackingNumber?: string | null) => {
  if (!trackingNumber) {
    return null;
  }
  const normalized = (carrier ?? "").toLowerCase();
  const encodedTracking = encodeURIComponent(trackingNumber);

  if (normalized.includes("ups")) {
    return `https://www.ups.com/track?loc=en_US&tracknum=${encodedTracking}`;
  }
  if (normalized.includes("usps")) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodedTracking}`;
  }
  if (normalized.includes("fedex") || normalized.includes("fed ex")) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodedTracking}`;
  }
  if (normalized.includes("dhl")) {
    return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodedTracking}`;
  }

  return null;
};

const resolveShippingAddress = (value: unknown): ShippingAddress | null => {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return (value[0] ?? null) as ShippingAddress | null;
  }
  if (typeof value === "object") {
    return value as ShippingAddress;
  }
  return null;
};

const formatAddress = (address: ShippingAddress | null) => {
  if (!address) {
    return null;
  }
  const clean = (value?: string | null) => (value ?? "").trim();
  const line1 = [clean(address.line1), clean(address.line2)].filter(Boolean).join(", ");
  const line2 = [clean(address.city), clean(address.state), clean(address.postal_code)]
    .filter(Boolean)
    .join(", ");
  const parts = [clean(address.name), line1, line2, clean(address.country)].filter(
    Boolean,
  );
  return parts.join(" - ");
};

const formatOriginAddress = (origin: ShippingOrigin | null) => {
  if (!origin) {
    return null;
  }
  const clean = (value?: string | null) => (value ?? "").trim();
  const line1 = [clean(origin.line1), clean(origin.line2)].filter(Boolean).join(", ");
  const line2 = [clean(origin.city), clean(origin.state), clean(origin.postal_code)]
    .filter(Boolean)
    .join(", ");
  const parts = [
    clean(origin.name),
    clean(origin.company),
    line1,
    line2,
    clean(origin.country),
  ].filter(Boolean);
  return parts.join(" - ");
};

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

const validateOrigin = (origin: ShippingOrigin): OriginErrors => {
  const errors: OriginErrors = {};
  const name = origin.name.trim();
  const company = (origin.company ?? "").trim();

  if (!name && !company) {
    const message = "Enter a contact name or company.";
    errors.name = message;
    errors.company = message;
  }
  if (!origin.line1.trim()) {
    errors.line1 = "Street address is required.";
  }
  if (!origin.city.trim()) {
    errors.city = "City is required.";
  }
  if (!origin.state.trim()) {
    errors.state = "State is required.";
  }
  if (!origin.postal_code.trim()) {
    errors.postal_code = "ZIP / postal code is required.";
  }
  if (!origin.country.trim()) {
    errors.country = "Country is required.";
  }

  return errors;
};

const formatPlacedAt = (value?: string | null) => {
  if (!value) {
    return { date: "-", time: "" };
  }
  const date = new Date(value);
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
};

const getCustomerName = (order: ShippingOrder) => {
  const address = resolveShippingAddress(order.shipping);
  const name = address?.name?.trim();
  if (name) {
    return name;
  }
  const profileName = (order.shipping_profile_name ?? "").trim();
  return profileName || "-";
};

const getPrimaryImage = (item: OrderItem) => {
  const images = item.product?.images ?? [];
  const primary = images.find((img) => img.is_primary) ?? images[0];
  return primary?.url ?? "/images/logo.png";
};

const getPackageProfile = (
  order: ShippingOrder,
  shippingDefaults: Record<string, ShippingDefault>,
) => {
  const defaults = Object.fromEntries(
    Object.entries(shippingDefaults).map(([category, entry]) => [
      category,
      {
        weight: Number(entry.default_weight_oz ?? DEFAULT_PACKAGE.weight),
        length: Number(entry.default_length_in ?? DEFAULT_PACKAGE.length),
        width: Number(entry.default_width_in ?? DEFAULT_PACKAGE.width),
        height: Number(entry.default_height_in ?? DEFAULT_PACKAGE.height),
      },
    ]),
  );

  return buildPackageProfile(
    (order.items ?? []).map((item) => ({
      quantity: item.quantity,
      category: item.product?.category ?? null,
    })),
    defaults,
  );
};

const orderParams = (tab: (typeof TABS)[number], page: number, limit: number) => {
  const params = new URLSearchParams({
    fulfillment: "ship",
    fulfillmentStatus: tab.status,
    page: String(page),
    limit: String(limit),
  });
  SHIPPING_ORDER_STATUSES.forEach((status) => params.append("status", status));
  return params;
};
const loadSetup = async (signal: AbortSignal) => {
  const [origin, defaults] = await Promise.all([
    fetchJsonWithDeadline<{ origin: ShippingOrigin | null }>(
      "/api/admin/shipping/origin",
      "Origin unavailable",
      signal,
    ),
    fetchJsonWithDeadline<{ defaults: ShippingDefault[] }>(
      "/api/admin/shipping/defaults",
      "Defaults unavailable",
      signal,
    ),
  ]);
  return {
    origin: origin.origin,
    defaults: Object.fromEntries(
      defaults.defaults.map((entry) => [entry.category, entry]),
    ),
  };
};
export default function ShippingPage() {
  const setup = useAdminRead(loadSetup, "shipping configuration");
  const fulfill = useAsyncAction();
  const originAction = useAsyncAction();
  const [commandMessage, setCommandMessage] = useState("");
  const [blockedLabel, setBlockedLabel] = useState<Record<string, boolean>>({});

  const [activeTab, setActiveTab] = useState<TabKey>("label");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const shippingDefaults = setup.data?.defaults;
  const [pageByTab, setPageByTab] = useState<Record<TabKey, number>>({
    label: 1,
    ready: 1,
    shipped: 1,
    delivered: 1,
  });
  const [markingShippedId, setMarkingShippedId] = useState<string | null>(null);
  const [confirmMarkShipped, setConfirmMarkShipped] = useState<ShippingOrder | null>(
    null,
  );
  const [selectedItem, setSelectedItem] = useState<OrderItem | null>(null);
  const [modalInvoker, setModalInvoker] = useState<HTMLElement | null>(null);
  const [originDraft, setOriginAddress] = useState<ShippingOrigin | null>(null);
  const [originModalOpen, setOriginModalOpen] = useState(false);
  const [originMessage, setOriginMessage] = useState("");
  const [originError, setOriginError] = useState("");
  const [originFieldErrors, setOriginFieldErrors] = useState<OriginErrors>({});
  const [savingOrigin, setSavingOrigin] = useState(false);

  const [labelOrder, setLabelOrder] = useState<ShippingOrder | null>(null);

  const [savedOrigin, setSavedOrigin] = useState<ShippingOrigin | null>(null);
  const originAddress = savedOrigin ?? setup.data?.origin ?? null;
  const currentPage = pageByTab[activeTab];
  const { list, totals, orders, counts, totalPages } = useAdminOrderQueue<
    ShippingOrder,
    (typeof TABS)[number]
  >(TABS, orderParams, activeTab, currentPage, PAGE_SIZE);
  if (list.data && currentPage > totalPages) {
    setPageByTab((prev) => ({ ...prev, [activeTab]: totalPages }));
  }

  const toggleItems = (orderId: string) => {
    setExpandedItems((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  const toggleDetails = (orderId: string) => {
    setExpandedDetails((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  const toggleOrderExpansion = (orderId: string) => {
    const nextExpanded = !(
      (expandedItems[orderId] ?? false) ||
      (expandedDetails[orderId] ?? false)
    );
    setExpandedItems((prev) => ({ ...prev, [orderId]: nextExpanded }));
    setExpandedDetails((prev) => ({ ...prev, [orderId]: nextExpanded }));
  };

  const openItemDetails = (item: OrderItem, invoker: HTMLElement) => {
    setModalInvoker(invoker);
    setSelectedItem(item);
  };

  const handleMarkShipped = async (order: ShippingOrder) => {
    setMarkingShippedId(order.id);
    try {
      const { response, data } = await adminCommand<{
        order?: { id: string };
        error?: string;
      }>(`/api/admin/orders/${order.id}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier: order.shipping_carrier ?? null,
          trackingNumber: order.tracking_number ?? null,
        }),
      });
      if (response.status >= 400 && response.status < 500) {
        setCommandMessage(data?.error ?? "Fulfillment request declined.");
        setConfirmMarkShipped(null);
        return;
      }
      if (!response.ok || data?.order?.id !== order.id)
        throw new Error("Unconfirmed fulfillment");
      setCommandMessage("Order marked shipped.");
      list.retry();
      totals.retry();
      setConfirmMarkShipped(null);
    } catch (error) {
      logError(error, { layer: "frontend", event: "admin_mark_shipped" });
      setConfirmMarkShipped(null);
      setCommandMessage("Shipment update is unconfirmed. Checking current order status.");
      list.retry();
      totals.retry();
    } finally {
      setMarkingShippedId(null);
    }
  };

  const handleOriginChange = (field: keyof ShippingOrigin, value: string) => {
    setOriginAddress((prev) => ({ ...(prev ?? EMPTY_ORIGIN), [field]: value }));
    if (originFieldErrors[field]) {
      setOriginFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (originError) {
      setOriginError("");
    }
  };

  const handleSaveOrigin = async () => {
    const payload = originDraft ?? EMPTY_ORIGIN;
    setSavingOrigin(true);
    setOriginError("");
    setOriginMessage("");
    setOriginFieldErrors({});

    const validationErrors = validateOrigin(payload);
    if (Object.keys(validationErrors).length > 0) {
      setOriginFieldErrors(validationErrors);
      setOriginError("Please fix the highlighted fields.");
      setSavingOrigin(false);
      return;
    }

    try {
      const { response, data } = await adminCommand<{
        origin?: ShippingOrigin;
        error?: string;
        issues?: Record<string, { _errors?: string[] }>;
      }>("/api/admin/shipping/origin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const fieldErrors = extractOriginErrors(data?.issues);
        if (Object.keys(fieldErrors).length > 0) {
          setOriginFieldErrors(fieldErrors);
          setOriginError("Please fix the highlighted fields.");
          return;
        }
        throw new Error(data?.error || "Failed to save origin");
      }
      setSavedOrigin(data?.origin ?? payload);
      setOriginMessage("Origin address updated.");
      setOriginModalOpen(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save origin.";
      setOriginError(message);
    } finally {
      setSavingOrigin(false);
    }
  };

  const handleLabelSuccess = () => {
    setCommandMessage("Label purchased. Customer notification queued.");
    setLabelOrder(null);
    list.retry();
    totals.retry();
    // Optionally switch to "Need to Ship" tab
    setActiveTab("ready");
  };

  const viewLabel = (order: ShippingOrder) => {
    // Get label URL - you'll need to add this to your order model
    const labelUrl = order.label_url ?? null;
    if (labelUrl) {
      window.open(labelUrl, "_blank", "noopener,noreferrer");
    }
  };

  const renderPagination = () => {
    if (totalPages <= 1) {
      return null;
    }

    const pages: number[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);

    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setPageByTab((prev) => ({
              ...prev,
              [activeTab]: Math.max(1, currentPage - 1),
            }))
          }
          disabled={currentPage === 1}
          className="rounded-sm border border-zinc-800/70 px-3 py-2 text-sm text-gray-300 disabled:border-zinc-900 disabled:text-zinc-600"
        >
          Previous
        </button>

        {start > 1 && (
          <button
            type="button"
            onClick={() => setPageByTab((prev) => ({ ...prev, [activeTab]: 1 }))}
            className="rounded-sm border border-zinc-800/70 px-3 py-2 text-sm text-gray-300"
          >
            1
          </button>
        )}
        {start > 2 && <span className="text-gray-500">...</span>}

        {pages.map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => setPageByTab((prev) => ({ ...prev, [activeTab]: page }))}
            className={`rounded-sm border px-3 py-2 text-sm ${
              page === currentPage
                ? "border-red-600 text-white"
                : "border-zinc-800/70 text-gray-300"
            }`}
          >
            {page}
          </button>
        ))}

        {end < totalPages - 1 && <span className="text-gray-500">...</span>}
        {end < totalPages && (
          <button
            type="button"
            onClick={() => setPageByTab((prev) => ({ ...prev, [activeTab]: totalPages }))}
            className="rounded-sm border border-zinc-800/70 px-3 py-2 text-sm text-gray-300"
          >
            {totalPages}
          </button>
        )}

        <button
          type="button"
          onClick={() =>
            setPageByTab((prev) => ({
              ...prev,
              [activeTab]: Math.min(totalPages, currentPage + 1),
            }))
          }
          disabled={currentPage === totalPages}
          className="rounded-sm border border-zinc-800/70 px-3 py-2 text-sm text-gray-300 disabled:border-zinc-900 disabled:text-zinc-600"
        >
          Next
        </button>
      </div>
    );
  };

  const renderOrderRow = (order: ShippingOrder) => {
    const itemCount = (order.items ?? []).reduce(
      (sum: number, item: OrderItem) => sum + Number(item.quantity ?? 0),
      0,
    );
    const address = resolveShippingAddress(order.shipping);
    const addressLine = formatAddress(address);
    const trackingUrl = getTrackingUrl(order.shipping_carrier, order.tracking_number);
    const placedAt = formatPlacedAt(order.created_at);
    const customerName = getCustomerName(order);
    const itemsExpanded = expandedItems[order.id] ?? false;
    const detailsExpanded = expandedDetails[order.id] ?? false;
    const colSpan = 8;
    const labelUrl = order.label_url ?? null;

    const actionNode =
      activeTab === "label" ? (
        <button
          type="button"
          aria-haspopup="dialog"
          disabled={
            !setup.data || list.pending || !!list.error || !!blockedLabel[order.id]
          }
          onClick={(event) => {
            event.stopPropagation();
            setModalInvoker(event.currentTarget);
            setLabelOrder(order);
          }}
          className="admin-button-primary"
        >
          Create label
        </button>
      ) : activeTab === "ready" ? (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={(event) => {
            event.stopPropagation();
            setModalInvoker(event.currentTarget);
            setConfirmMarkShipped(order);
          }}
          disabled={list.pending || !!list.error || fulfill.pending}
          className="text-sm text-zinc-400 hover:text-zinc-300 disabled:text-zinc-600"
        >
          {markingShippedId === order.id ? "Marking..." : "Mark shipped"}
        </button>
      ) : (
        <span className="text-zinc-500">-</span>
      );

    return (
      <Fragment key={order.id}>
        <tr
          onClick={() => toggleOrderExpansion(order.id)}
          className="cursor-pointer border-b border-zinc-800/70 hover:bg-zinc-800/60"
        >
          <td className="p-3 text-gray-400 sm:p-4">
            {placedAt.date !== "-" ? (
              <div className="space-y-1">
                <div>{placedAt.date}</div>
                {placedAt.time && (
                  <div className="text-xs text-gray-500">{placedAt.time}</div>
                )}
              </div>
            ) : (
              "-"
            )}
          </td>
          <td className="p-3 text-white sm:p-4">
            <button
              type="button"
              aria-expanded={itemsExpanded || detailsExpanded}
              aria-label={`Details for order ${order.id}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleOrderExpansion(order.id);
              }}
            >
              #{order.id.slice(0, 8)}
            </button>
          </td>
          <td className="hidden p-3 text-gray-400 sm:p-4 md:table-cell">
            {customerName}
          </td>
          <td className="hidden max-w-[320px] truncate p-3 text-gray-400 sm:p-4 md:table-cell">
            {addressLine ? (
              addressLine
            ) : (
              <span className="text-red-400">Missing address</span>
            )}
          </td>

          {/* SWAPPED: Tracking column now comes before Label */}
          <td className="hidden p-3 text-gray-400 sm:p-4 md:table-cell">
            {order.tracking_number ? (
              <div className="space-y-1">
                {trackingUrl ? (
                  <a
                    href={trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="flex items-center gap-1 text-red-400 hover:text-red-300"
                  >
                    {order.tracking_number}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-zinc-300">{order.tracking_number}</span>
                )}
              </div>
            ) : (
              <span className="text-zinc-500">No tracking yet</span>
            )}
          </td>

          <td className="hidden p-3 text-gray-400 sm:p-4 md:table-cell">
            {labelUrl ? (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  viewLabel(order);
                }}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Print Label
              </button>
            ) : (
              <span className="text-zinc-500">No label yet</span>
            )}
          </td>

          <td className="p-3 text-left sm:p-4 md:text-right">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleItems(order.id);
              }}
              className="hidden items-center gap-2 text-sm text-red-400 hover:text-red-300 md:inline-flex"
            >
              {itemsExpanded ? "Hide items" : `View items (${itemCount})`}
              <ChevronDown
                className={`h-4 w-4 transition-transform ${itemsExpanded ? "rotate-180" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleDetails(order.id);
              }}
              className="inline-flex w-full items-center justify-start gap-1 whitespace-nowrap text-[12px] leading-none text-red-400 hover:text-red-300 md:hidden"
            >
              {detailsExpanded ? "Hide label info" : "Label info"}
              <ChevronDown
                className={`h-4 w-4 transition-transform ${detailsExpanded ? "rotate-180" : ""}`}
              />
            </button>
          </td>
          <td className="hidden p-3 text-right sm:p-4 md:table-cell">{actionNode}</td>
        </tr>

        {itemsExpanded && (
          <tr className="hidden bg-zinc-50 md:table-row">
            <td colSpan={colSpan} className="border-b border-zinc-800/70 p-0">
              <div className="flex flex-col">
                {(order.items ?? []).map((item: OrderItem) => {
                  const imageUrl = getPrimaryImage(item);
                  const title = item.product_name ?? item.product?.name ?? "Item";
                  const itemFinancials = getOrderItemFinancials(item);
                  const isPositive = itemFinancials.unitProfit >= 0;
                  const isRefunded = Boolean(item.refunded_at);

                  return (
                    <div
                      key={item.id}
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        openItemDetails(item, event.currentTarget);
                      }}
                      className={`group relative cursor-pointer px-6 py-4 transition-colors ${
                        isRefunded
                          ? "border-y border-red-900/40 bg-red-950/20"
                          : "hover:bg-zinc-800"
                      }`}
                    >
                      {isRefunded && (
                        <span className="absolute inset-y-0 left-0 w-1 bg-red-500/80" />
                      )}
                      <div
                        className={`flex items-center justify-start gap-8 ${
                          isRefunded ? "opacity-60" : ""
                        }`}
                      >
                        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-sm border border-zinc-800 bg-black">
                          <Image
                            unoptimized
                            width={400}
                            height={400}
                            src={imageUrl}
                            alt={title}
                            className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                          />
                        </div>

                        <div className="w-48 flex-shrink-0">
                          <div className="mb-0.5 text-[10px] uppercase tracking-tight text-gray-500">
                            Product
                          </div>
                          <div
                            className="truncate text-sm font-semibold text-white"
                            title={title}
                          >
                            {title}
                          </div>
                        </div>

                        <div className="w-28 flex-shrink-0">
                          <div className="mb-0.5 text-[10px] uppercase tracking-tight text-gray-500">
                            Size
                          </div>
                          <div className="text-sm font-medium text-gray-300">
                            {item.size_label ?? "N/A"}
                          </div>
                        </div>

                        <div className="w-24 flex-shrink-0">
                          <div className="mb-0.5 text-[10px] uppercase tracking-tight text-gray-500">
                            Qty
                          </div>
                          <div className="text-sm font-medium text-gray-300">
                            {item.quantity}
                          </div>
                        </div>

                        <div className="w-32 flex-shrink-0 text-left">
                          <div className="mb-0.5 text-[10px] uppercase tracking-tight text-gray-500">
                            Line Total
                          </div>
                          <div className="text-sm font-bold text-white">
                            ${Number(item.line_total ?? 0).toFixed(2)}
                          </div>
                        </div>

                        <div className="w-32 flex-shrink-0 text-left">
                          <div className="mb-0.5 text-[10px] uppercase tracking-tight text-gray-500">
                            Profit
                          </div>
                          <div
                            className={`text-sm font-bold ${isPositive ? "text-green-400" : "text-red-400"}`}
                          >
                            {isPositive ? "+" : "-"}$
                            {Math.abs(itemFinancials.unitProfit).toFixed(2)}
                          </div>
                        </div>

                        <div className="w-20 flex-shrink-0">
                          {isRefunded ? (
                            <span className="inline-flex items-center rounded-sm border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
                              Refunded
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-red-500 transition-colors group-hover:text-red-400">
                              Details
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </td>
          </tr>
        )}

        {detailsExpanded && (
          <tr className="border-b border-zinc-800/70 bg-zinc-50 md:hidden">
            <td colSpan={colSpan} className="px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-gray-500">Customer</span>
                  <span className="text-white">{customerName}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-gray-500">Destination</span>
                  <span className="break-words text-white">
                    {addressLine ? addressLine : "Missing address"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-gray-500">Tracking</span>
                  <span className="text-white">
                    {order.tracking_number ? (
                      trackingUrl ? (
                        <a
                          href={trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-red-400 hover:text-red-300"
                        >
                          {order.tracking_number}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        order.tracking_number
                      )
                    ) : (
                      <span className="text-zinc-500">No tracking yet</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-gray-500">Label</span>
                  <span className="text-white">
                    {labelUrl ? (
                      <button
                        onClick={() => viewLabel(order)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Print label
                      </button>
                    ) : (
                      <span className="text-zinc-500">No label yet</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-gray-500">Action</span>
                  <span className="text-white">{actionNode}</span>
                </div>
              </div>

              <div className="mt-4 border-t border-zinc-800/70 pt-4">
                <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">
                  Items
                </div>
                <div className="space-y-2">
                  {(order.items ?? []).map((item: OrderItem) => {
                    const imageUrl = getPrimaryImage(item);
                    const title = item.product_name ?? item.product?.name ?? "Item";
                    const itemFinancials = getOrderItemFinancials(item);
                    const formattedUnitProfit = `${
                      itemFinancials.unitProfit >= 0 ? "+" : "-"
                    }$${Math.abs(itemFinancials.unitProfit).toFixed(2)}`;
                    const isRefunded = Boolean(item.refunded_at);
                    return (
                      <div
                        key={item.id}
                        tabIndex={-1}
                        onClick={(event) => openItemDetails(item, event.currentTarget)}
                        className={`relative flex cursor-pointer items-start gap-3 rounded-sm p-2 text-base transition ${
                          isRefunded
                            ? "border border-red-900/40 bg-red-950/20"
                            : "hover:bg-zinc-800/60"
                        }`}
                      >
                        {isRefunded && (
                          <span className="absolute inset-y-0 left-0 w-1 rounded-l-sm bg-red-500/80" />
                        )}
                        <Image
                          unoptimized
                          width={400}
                          height={400}
                          src={imageUrl}
                          alt={title}
                          className="h-14 w-14 flex-shrink-0 border border-zinc-800/70 bg-black object-cover"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-white">{title}</div>
                          <div className="text-sm text-zinc-500">
                            Size {item.size_label ?? "N/A"} - Qty {item.quantity}
                          </div>
                          <div className="mt-0.5 text-sm font-medium text-white">
                            ${Number(item.line_total ?? 0).toFixed(2)}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            Price ${itemFinancials.unitPrice.toFixed(2)} - Profit{" "}
                            <span
                              className={
                                itemFinancials.unitProfit >= 0
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {formattedUnitProfit}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openItemDetails(item, event.currentTarget);
                            }}
                            className="mt-1 text-xs text-red-400 hover:text-red-300"
                          >
                            View more details
                          </button>
                        </div>
                        {isRefunded && (
                          <div className="absolute right-2 top-2">
                            <span className="inline-flex items-center rounded-sm border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-300">
                              Refunded
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const tabBadge = (count: number) => (count > 99 ? "99+" : String(count));
  const originLine = formatOriginAddress(originAddress);

  const labelModalDefaults = useMemo(
    () => (labelOrder ? getPackageProfile(labelOrder, shippingDefaults ?? {}) : null),
    [labelOrder, shippingDefaults],
  );

  return (
    <AdminPage>
      <AdminPageHeader
        eyebrow="Fulfillment"
        title="Shipping"
        description="Review orders, create labels, and monitor outbound fulfillment."
      />

      {activeTab === "ready" && (
        <div className="rounded-sm border border-blue-400/20 bg-blue-400/10 p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400 sm:h-5 sm:w-5" />
            <div className="text-[12px] text-blue-300 sm:text-sm">
              <strong>Automatic tracking:</strong> Once you ship packages, Shippo will
              automatically update tracking status and send customer emails. The
              &quot;Mark shipped&quot; button should only be used if the carrier
              hasn&apos;t scanned the package yet.
            </div>
          </div>
        </div>
      )}

      <AdminReadStatus read={setup} label="Loading shipping configuration" shape="form" />
      {commandMessage && <p role="status">{commandMessage}</p>}
      {originMessage && <p role="status">{originMessage}</p>}
      <AdminReadStatus read={totals} label="Loading queue counts" />
      <div
        data-admin-tabs
        className="flex flex-nowrap gap-2 overflow-x-auto border-b border-zinc-800/70 sm:gap-6"
      >
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            aria-pressed={activeTab === tab.key}
            className={`flex items-center gap-1 whitespace-nowrap py-2.5 text-[10px] font-medium transition-colors sm:gap-2 sm:text-sm ${
              activeTab === tab.key
                ? "border-b-2 border-red-600 text-white"
                : "border-b-2 border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {tab.label}
            <span className="rounded-sm border border-zinc-800/70 bg-zinc-900 px-1 py-0.5 text-[9px] text-gray-300 sm:px-2 sm:text-[11px]">
              {counts?.[tab.key] === undefined ? "—" : tabBadge(counts[tab.key]!)}
            </span>
          </button>
        ))}
      </div>

      <div
        data-admin-toolbar
        className="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        <div className="text-gray-400">
          <span className="text-gray-500">Origin:</span>{" "}
          {setup.data ? originLine || "Not set" : "—"}
        </div>
        <button
          type="button"
          aria-haspopup="dialog"
          disabled={!setup.data}
          onClick={(event) => {
            setModalInvoker(event.currentTarget);
            setOriginError("");
            setOriginMessage("");
            setOriginFieldErrors({});
            setOriginModalOpen(true);
            setOriginAddress(originAddress);
          }}
          className="border border-zinc-800/70 bg-zinc-900 px-4 py-2 text-sm text-white hover:border-zinc-700"
        >
          Change origin address
        </button>
      </div>

      <AdminReadStatus read={list} shape="table" label="Loading orders" />
      {!list.data ? null : orders.length === 0 ? (
        <div className="rounded-sm border border-zinc-800/70 bg-zinc-900 p-6 text-sm text-zinc-500">
          No orders in this queue.
        </div>
      ) : (
        <div
          data-admin-table-shell
          className="overflow-x-hidden overflow-y-visible rounded-sm border border-zinc-800/70 bg-zinc-900 md:overflow-x-auto"
        >
          <table className="w-full text-[12px] sm:text-sm">
            <thead>
              <tr className="bg-zinc-800">
                <th className="sticky top-0 z-10 bg-zinc-800 p-3 text-left font-semibold text-gray-400 sm:p-4">
                  Placed At
                </th>
                <th className="sticky top-0 z-10 bg-zinc-800 p-3 text-left font-semibold text-gray-400 sm:p-4">
                  Order
                </th>
                <th className="sticky top-0 z-10 hidden bg-zinc-800 p-3 text-left font-semibold text-gray-400 sm:p-4 md:table-cell">
                  Customer
                </th>
                <th className="sticky top-0 z-10 hidden bg-zinc-800 p-3 text-left font-semibold text-gray-400 sm:p-4 md:table-cell">
                  Destination
                </th>

                {/* SWAPPED: Tracking header now before Label */}
                <th className="sticky top-0 z-10 hidden bg-zinc-800 p-3 text-left font-semibold text-gray-400 sm:p-4 md:table-cell">
                  Tracking
                </th>
                <th className="sticky top-0 z-10 hidden bg-zinc-800 p-3 text-left font-semibold text-gray-400 sm:p-4 md:table-cell">
                  Label
                </th>

                <th className="sticky top-0 z-10 bg-zinc-800 p-3 text-left font-semibold text-gray-400 sm:p-4 md:text-right">
                  <span className="hidden md:inline">Items</span>
                  <span className="md:hidden">Actions</span>
                </th>
                <th className="sticky top-0 z-10 hidden bg-zinc-800 p-3 text-right font-semibold text-gray-400 sm:p-4 md:table-cell">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>{orders.map((order) => renderOrderRow(order))}</tbody>
          </table>
        </div>
      )}

      {renderPagination()}

      <AdminOrderItemDetailsModal
        open={Boolean(selectedItem)}
        item={selectedItem}
        invoker={modalInvoker}
        onClose={() => setSelectedItem(null)}
      />
      <CreateLabelForm
        invoker={modalInvoker}
        open={!!labelOrder}
        order={labelOrder}
        originLine={originLine}
        initialPackage={
          labelModalDefaults
            ? {
                weight: labelModalDefaults.weight,
                length: labelModalDefaults.length,
                width: labelModalDefaults.width,
                height: labelModalDefaults.height,
              }
            : null
        }
        onClose={() => setLabelOrder(null)}
        onUnconfirmed={(orderId) => {
          setBlockedLabel((prev) => ({ ...prev, [orderId]: true }));
          setCommandMessage(
            "Label purchase is unconfirmed. Check the order and Shippo transaction history before buying another label.",
          );
          list.retry();
          totals.retry();
        }}
        onSuccess={handleLabelSuccess}
      />

      <ConfirmDialog
        invoker={modalInvoker}
        isOpen={!!confirmMarkShipped}
        title="Mark as shipped manually?"
        description="Important: This should only be used if the carrier hasn't scanned the package yet. Normally, Shippo automatically updates tracking status and sends customer emails when the carrier scans the package. Using this button will manually update the status without waiting for carrier confirmation."
        confirmLabel={fulfill.pending ? "Marking shipped…" : "Mark shipped anyway"}
        onConfirm={() => {
          if (confirmMarkShipped) {
            void fulfill.run(() => handleMarkShipped(confirmMarkShipped));
          }
        }}
        onCancel={() => {
          if (!fulfill.pending) setConfirmMarkShipped(null);
        }}
      />

      <OriginModal
        invoker={modalInvoker}
        open={originModalOpen}
        originAddress={originDraft}
        emptyOrigin={EMPTY_ORIGIN}
        originError={originError}
        originMessage={originMessage}
        originFieldErrors={originFieldErrors}
        savingOrigin={savingOrigin}
        onClose={() => {
          if (!savingOrigin) setOriginModalOpen(false);
        }}
        onChange={handleOriginChange}
        onSave={() => {
          void originAction.run(handleSaveOrigin);
        }}
      />
    </AdminPage>
  );
}
