"use client";
import { useAdminRead } from "@/components/admin/useAdminRead";
import { AdminReadStatus } from "@/components/admin/AdminSkeletons";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { ActionButton } from "@/components/ui/ActionButton";
import { ModalPortal } from "@/components/ui/ModalPortal";
import {
  adminCommand,
  pendingProviderCheck,
  rememberProviderCheck,
} from "@/components/admin/admin-command";

import Image from "next/image";

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CheckCircle,
  Clock,
  ExternalLink,
  Info,
  Mail,
  Package,
  RefreshCw,
  Truck,
  X,
  XCircle,
} from "lucide-react";

import {
  AdminOrderItemDetailsModal,
  getOrderItemFinancials,
} from "@/components/admin/orders/OrderItemDetailsModal";
import { AdminPage, AdminPageHeader } from "@/components/admin/AdminPage";
import type { AdminOrderItem } from "@/components/admin/orders/OrderItemDetailsModal";
import { Toast } from "@/components/ui/Toast";
import { shouldShowOrderProfit } from "@/lib/orders/metrics";
import { paymentMethodLabel } from "@/lib/orders/payment-method";
import { checkoutStatusLabel } from "@/lib/orders/checkout-status-label";

type ProductImage = { url: string; is_primary?: boolean; sort_order?: number };

type OrderItem = {
  id: string;
  product_name?: string | null;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  condition?: string | null;
  variant_sku?: string | null;
  size_label?: string | null;
  quantity: number;
  unit_price: number;
  unit_cost?: number | null;
  line_total: number;
  refund_amount?: number | null;
  refunded_at?: string | null;
  product?: {
    id: string;
    name: string;
    brand?: string | null;
    model?: string | null;
    category?: string | null;
    description?: string | null;
    created_at?: string | null;
    images?: ProductImage[];
  } | null;
  variant?: {
    id: string;
    sku?: string | null;
    sale_price_cents?: number | null;
    unit_cost_cents?: number | null;
  } | null;
};

type OrderShipping = {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
};

type Order = {
  id: string;
  user_id?: string | null;
  status?: string | null;
  expires_at?: string | null;
  total?: number | null;
  subtotal?: number | null;
  shipping?: number | null;
  tax_amount?: number | null;
  refund_amount?: number | null;
  refunded_at?: string | null;
  fulfillment?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  guest_email?: string | null;
  failure_reason?: string | null;
  tracking_number?: string | null;
  shipping_carrier?: string | null;
  label_url?: string | null;
  label_created_at?: string | null;
  profiles?: { email?: string | null; full_name?: string | null } | null;
  items?: OrderItem[];
  shipping_address?: OrderShipping | OrderShipping[] | null;
};

type PaymentTransaction = {
  payment_method?: string | null;
  id: string;
  card_type?: string | null;
  card_last4?: string | null;
  card_expiry_month?: number | null;
  card_expiry_year?: number | null;
  avs_result_code?: string | null;
  cvv2_result_code?: string | null;
  three_ds_status?: string | null;
  amount_authorized?: number | null;
  amount_captured?: number | null;
  billing_name?: string | null;
  billing_address?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_zip?: string | null;
  billing_country?: string | null;
  billing_phone?: string | null;
  customer_email?: string | null;
  customer_ip?: string | null;
};

type EmailLog = {
  id: string;
  email_type: string;
  recipient_email: string;
  subject?: string | null;
  sent_at: string;
  delivered_at?: string | null;
  opened_at?: string | null;
  delivery_status: string;
  message_id?: string | null;
  html_snapshot?: string | null;
};

type TransactionPayload = {
  order: Order;
  paymentTransaction: PaymentTransaction | null;
  emailLogs: EmailLog[];
  emailLogsAvailable?: boolean;
  customer?: {
    displayId: string;
    kind: "account" | "guest";
    name: string;
    email: string | null;
  } | null;
};

const SHIPPING_EMAIL_TYPES = [
  "order_confirmation",
  "label_created",
  "in_transit",
  "delivered",
] as const;
const PICKUP_EMAIL_TYPES = ["order_confirmation", "pickup_instructions"] as const;
const REFUND_EMAIL_TYPE = "refund_notification" as const;

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtMoney = (value: number | null | undefined) => fmt.format(Number(value ?? 0));

function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) {
    return "-";
  }

  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...opts,
  });
}

function getOrderStatusMeta(status: string | null | undefined) {
  switch (status) {
    case "paid":
      return {
        label: "Succeeded",
        cls: "border border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "shipped":
      return {
        label: "Shipped",
        cls: "border border-sky-200 bg-sky-50 text-sky-700",
      };
    case "refunded":
      return {
        label: "Refunded",
        cls: "border border-rose-200 bg-rose-50 text-rose-700",
      };
    case "partially_refunded":
      return {
        label: "Partially refunded",
        cls: "border border-amber-200 bg-amber-50 text-amber-700",
      };
    case "refund_pending":
      return {
        label: "Refund pending",
        cls: "border border-amber-200 bg-amber-50 text-amber-700",
      };
    case "refund_failed":
      return {
        label: "Refund failed",
        cls: "border border-rose-200 bg-rose-50 text-rose-700",
      };
    case "failed":
      return { label: "Failed", cls: "border border-red-200 bg-red-50 text-red-700" };
    case "blocked":
      return {
        label: "Blocked",
        cls: "border border-orange-200 bg-orange-50 text-orange-700",
      };
    case "review":
      return {
        label: "Under review",
        cls: "border border-yellow-200 bg-yellow-50 text-yellow-700",
      };
    case "pending":
      return {
        label: "Incomplete",
        cls: "border border-zinc-200 bg-zinc-100 text-zinc-700",
      };
    default:
      return {
        label: status ?? "Unknown",
        cls: "border border-zinc-200 bg-zinc-100 text-zinc-700",
      };
  }
}

function getAvsLabel(code: string | null | undefined) {
  if (!code) {
    return { label: "-", color: "text-zinc-500" };
  }

  const map: Record<string, { label: string; color: string }> = {
    YYY: { label: `Address & ZIP match (${code})`, color: "text-emerald-400" },
    AVS_ACCEPTED: { label: "Address verified", color: "text-emerald-400" },
    AVS_REJECTED: { label: "Address did not match", color: "text-red-400" },
    AVS_NOT_CHECKED: { label: "Not checked", color: "text-zinc-400" },
    YYX: { label: `Exact match (${code})`, color: "text-emerald-400" },
    GGG: { label: `International match (${code})`, color: "text-emerald-400" },
    NYZ: { label: `ZIP match only (${code})`, color: "text-amber-400" },
    YNA: { label: `Address match only (${code})`, color: "text-amber-400" },
    NNN: { label: `No match (${code})`, color: "text-red-400" },
    XXU: { label: `Unavailable (${code})`, color: "text-zinc-400" },
  };

  return map[code] ?? { label: `Code: ${code}`, color: "text-zinc-400" };
}

function getCvvLabel(code: string | null | undefined) {
  if (!code) {
    return { label: "-", color: "text-zinc-500" };
  }

  const map: Record<string, { label: string; color: string }> = {
    M: { label: "Match (M)", color: "text-emerald-400" },
    CVV_ACCEPTED: { label: "Verified", color: "text-emerald-400" },
    CVV_REJECTED: { label: "Did not match", color: "text-red-400" },
    CVV_NOT_CHECKED: { label: "Not checked", color: "text-zinc-400" },
    N: { label: "No match (N)", color: "text-red-400" },
    P: { label: "Not processed (P)", color: "text-zinc-400" },
    U: { label: "Unavailable (U)", color: "text-zinc-400" },
    X: { label: "Not applicable (X)", color: "text-zinc-400" },
  };

  return map[code] ?? { label: `Code: ${code}`, color: "text-zinc-400" };
}

function getEmailTypeMeta(type: string) {
  switch (type) {
    case "order_confirmation":
      return {
        label: "Order confirmation",
        icon: <Package className="h-4 w-4 text-blue-400" />,
      };
    case "refund_notification":
    case "order_refunded":
      return {
        label: "Refund confirmation",
        icon: <Info className="h-4 w-4 text-red-400" />,
      };
    case "label_created":
      return {
        label: "Label created",
        icon: <Truck className="h-4 w-4 text-zinc-400" />,
      };
    case "in_transit":
      return { label: "In transit", icon: <Truck className="h-4 w-4 text-blue-400" /> };
    case "delivered":
      return {
        label: "Delivered",
        icon: <CheckCircle className="h-4 w-4 text-emerald-400" />,
      };
    case "pickup_instructions":
      return {
        label: "Pickup instructions",
        icon: <Package className="h-4 w-4 text-zinc-400" />,
      };
    default:
      return {
        label: type.replace(/_/g, " "),
        icon: <Mail className="h-4 w-4 text-zinc-400" />,
      };
  }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-800/50 py-2 last:border-0">
      <span className="min-w-[120px] shrink-0 text-sm text-zinc-500">{label}</span>
      <span className="text-right text-sm text-gray-200">{children}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded border border-zinc-800/70 bg-zinc-900 p-5">
      <h2 className="mb-4 text-xs uppercase tracking-widest text-zinc-500">{title}</h2>
      {children}
    </div>
  );
}

export default function TransactionDetailPage() {
  const params = useParams();

  const orderId = params.orderId as string;
  return <TransactionDetail key={orderId} orderId={orderId} />;
}
function TransactionDetail({ orderId }: { orderId: string }) {
  const router = useRouter();

  const load = useCallback(
    (signal: AbortSignal) =>
      fetchJsonWithDeadline<TransactionPayload>(
        `/api/admin/transactions/${orderId}`,
        "Transaction unavailable",
        signal,
      ),
    [orderId],
  );
  const read = useAdminRead(load, "transaction");
  const order = read.data?.order;
  const paymentTx = read.data?.paymentTransaction;
  const auditAvailable =
    read.data?.emailLogsAvailable !== false && Array.isArray(read.data?.emailLogs);
  const emailLogs = read.data?.emailLogs ?? [];
  const customerSummary = read.data?.customer;
  const command = useAsyncAction();
  const [previewInvoker, setPreviewInvoker] = useState<HTMLElement | null>(null);
  const [uncertain, setUncertain] = useState<Record<string, string>>({});
  const [emailPreview, setEmailPreview] = useState<EmailLog | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  } | null>(null);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<AdminOrderItem | null>(null);
  const [itemInvoker, setItemInvoker] = useState<HTMLButtonElement | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);

  const handleResendEmail = async (emailType: string, logId: string) => {
    if (
      !order ||
      resendingEmail ||
      !auditAvailable ||
      emailLogs.some(
        (log) => log.email_type === emailType && log.delivery_status === "pending",
      )
    ) {
      return;
    }

    const key = "email:" + order.id + ":" + emailType;
    if (pendingProviderCheck(key)) return;
    rememberProviderCheck(key, logId);
    setResendingEmail(emailType);
    try {
      const { response, data } = await adminCommand<{
        success?: boolean;
        error?: string;
      }>(`/api/admin/orders/${order.id}/resend-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailType }),
      });
      if (response.ok && data?.success) {
        rememberProviderCheck(key, null);
        setToast({ message: "Email resent successfully.", tone: "success" });
        read.retry();
      } else if (response.status >= 400 && response.status < 500) {
        rememberProviderCheck(key, null);
        setToast({ message: data?.error ?? "Email request declined.", tone: "error" });
      } else throw new Error("Unknown delivery");
    } catch {
      setUncertain((previous) => ({ ...previous, [emailType]: logId }));
      setToast({
        message:
          "Email delivery is unconfirmed. Check the email log before sending again.",
        tone: "info",
      });
      read.retry();
    } finally {
      setResendingEmail(null);
    }
  };
  if (!order)
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => router.push("/admin/transactions")}>
          Back to Transactions
        </button>
        <AdminReadStatus read={read} shape="detail" label="Loading transaction" />
        {read.data && <p>Transaction not found.</p>}
      </div>
    );
  const statusMeta = getOrderStatusMeta(order.status);
  statusMeta.label =
    checkoutStatusLabel(order.status, order.failure_reason, order.expires_at) ??
    statusMeta.label;
  const shippingAddr = Array.isArray(order.shipping_address)
    ? order.shipping_address[0]
    : order.shipping_address;
  const items = order.items ?? [];
  const subtotal = Number(order.subtotal ?? 0);
  const shipping = Number(order.shipping ?? 0);
  const tax = Number(order.tax_amount ?? 0);
  const total = Number(order.total ?? 0);
  const refundedCents = Math.round(Number(order.refund_amount ?? 0));
  const refundedAmount = refundedCents / 100;
  const showOrderProfit = shouldShowOrderProfit(order.status);
  const showPriceBreakdown = order.status !== "pending";
  const isPickup = order.fulfillment === "pickup";
  const isOrderPlaced = [
    "paid",
    "shipped",
    "refunded",
    "partially_refunded",
    "refund_pending",
    "refund_failed",
  ].includes(order.status ?? "");
  const paymentAttemptMade =
    isOrderPlaced || ["failed", "blocked", "review"].includes(order.status ?? "");
  const totalItemCost = items.reduce((sum, item) => {
    const financials = getOrderItemFinancials(item as AdminOrderItem);
    return sum + financials.unitCost * financials.quantity;
  }, 0);
  const refundedItemCost = items.reduce((sum, item) => {
    if (!item.refunded_at) {
      return sum;
    }
    const financials = getOrderItemFinancials(item as AdminOrderItem);
    return sum + financials.unitCost * financials.quantity;
  }, 0);
  const effectiveItemCost = Math.max(0, totalItemCost - refundedItemCost);
  const storeRevenue = Math.max(total - refundedAmount, 0);
  const totalProfit = storeRevenue - effectiveItemCost;

  const customerEmail =
    order.profiles?.email ?? order.guest_email ?? paymentTx?.customer_email ?? null;
  const customerName =
    shippingAddr?.name ?? order.profiles?.full_name ?? paymentTx?.billing_name ?? "-";
  const customerPhone = shippingAddr?.phone ?? paymentTx?.billing_phone ?? null;
  const checklistTypes = [
    ...(isPickup ? PICKUP_EMAIL_TYPES : SHIPPING_EMAIL_TYPES),
    ...(refundedCents > 0 ? [REFUND_EMAIL_TYPE] : []),
  ];

  const openItemModal = (item: OrderItem, invoker: HTMLButtonElement) => {
    setItemInvoker(invoker);
    setSelectedItem(item as unknown as AdminOrderItem);
    setItemModalOpen(true);
  };

  return (
    <AdminPage>
      <AdminReadStatus read={read} label="Refreshing transaction" shape="detail" />
      <AdminPageHeader
        eyebrow="Transaction detail"
        title={`#${order.id.slice(0, 8)}`}
        description={order.failure_reason || "Order, payment, and fulfillment activity."}
        backHref="/admin/transactions"
        backLabel="Transactions"
        meta={
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] ${statusMeta.cls}`}
          >
            {statusMeta.label}
          </span>
        }
        actions={
          refundedCents > 0 ? (
            <div className="text-right text-sm font-medium text-red-500">
              -{fmtMoney(refundedAmount)} refunded
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.9fr)]">
        <div className="space-y-6">
          <SectionCard title="Price Breakdown">
            {!showPriceBreakdown && (
              <p className="-mt-2 mb-4 text-xs text-zinc-600">
                Products from this checkout session are shown below. Pricing becomes final
                once checkout completes.
              </p>
            )}

            {items.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No products were recorded for this order.
              </p>
            ) : (
              <div className="space-y-0">
                {items.map((item) => {
                  const title = item.product_name ?? item.product?.name ?? "Item";
                  const imageUrl =
                    item.product?.images?.find((image) => image.is_primary)?.url ??
                    item.product?.images?.[0]?.url ??
                    "/images/logo.png";
                  const isRefunded = Boolean(item.refunded_at);
                  const showItemProfit = showOrderProfit && !isRefunded;
                  const financials = getOrderItemFinancials(item as AdminOrderItem);
                  const itemCost = financials.unitCost * financials.quantity;
                  const itemProfit = financials.unitProfit * financials.quantity;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={(event) => openItemModal(item, event.currentTarget)}
                      className={`group -mx-2 flex w-full items-start gap-4 rounded-sm border border-transparent px-2 py-3 text-left transition-colors hover:border-zinc-700/80 hover:bg-zinc-800/50 ${isRefunded ? "opacity-50" : ""}`}
                    >
                      <div className="h-10 w-10 shrink-0 overflow-hidden border border-zinc-800 bg-zinc-950">
                        <Image
                          unoptimized
                          width={400}
                          height={400}
                          src={imageUrl}
                          alt={title}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-white">{title}</p>
                        <p className="text-xs text-zinc-500">
                          {item.size_label ? `Size ${item.size_label} · ` : ""}
                          Qty {item.quantity}
                          {isRefunded ? " · Refunded" : ""}
                        </p>
                        {showPriceBreakdown ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <div className="rounded border border-zinc-800/70 bg-zinc-950/70 p-3">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                Customer paid
                              </p>
                              <p className="mt-1 text-sm font-semibold text-white">
                                {fmtMoney(item.line_total)}
                              </p>
                            </div>
                            <div className="rounded border border-zinc-800/70 bg-zinc-950/70 p-3">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                Product cost
                              </p>
                              <p className="mt-1 text-sm font-semibold text-zinc-300">
                                {fmtMoney(itemCost)}
                              </p>
                            </div>
                            {showItemProfit && (
                              <div className="rounded border border-zinc-800/70 bg-zinc-950/70 p-3">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                  Profit
                                </p>
                                <p
                                  className={`mt-1 text-sm font-semibold ${itemProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}
                                >
                                  {itemProfit >= 0 ? "+" : ""}
                                  {fmtMoney(itemProfit)}
                                </p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                            Session item
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">
                          View details
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {showPriceBreakdown && (
              <div className="grid gap-3 border-t border-zinc-800/70 pt-4 text-sm lg:grid-cols-2">
                <div className="space-y-2 rounded border border-zinc-800/70 bg-zinc-950/50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Customer breakdown
                  </p>
                  <div className="flex justify-between text-zinc-400">
                    <span>Subtotal</span>
                    <span>{fmtMoney(subtotal)}</span>
                  </div>
                  {(shipping > 0 || order.fulfillment === "ship") && (
                    <div className="flex justify-between text-zinc-400">
                      <span>Shipping</span>
                      <span>{fmtMoney(shipping)}</span>
                    </div>
                  )}
                  {tax > 0 && (
                    <div className="flex justify-between text-zinc-400">
                      <span>Tax</span>
                      <span>{fmtMoney(tax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-zinc-800/70 pt-2 font-semibold text-white">
                    <span>Customer total</span>
                    <span>{fmtMoney(total)}</span>
                  </div>
                </div>

                <div className="space-y-2 rounded border border-zinc-800/70 bg-zinc-950/50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Store breakdown
                  </p>
                  {isOrderPlaced ? (
                    <>
                      {refundedCents > 0 && (
                        <div className="flex justify-between text-red-400">
                          <span>Refunded</span>
                          <span>-{fmtMoney(refundedAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-zinc-300">
                        <span>Revenue before processor fees</span>
                        <span>{fmtMoney(storeRevenue)}</span>
                      </div>
                      {showOrderProfit ? (
                        <>
                          <div className="flex justify-between text-red-400">
                            <span>Product cost</span>
                            <span>-{fmtMoney(effectiveItemCost)}</span>
                          </div>
                          <div className="flex justify-between border-t border-zinc-800/70 pt-2 font-semibold text-white">
                            <span>Gross profit before processor fees</span>
                            <span
                              className={
                                totalProfit >= 0 ? "text-emerald-400" : "text-red-400"
                              }
                            >
                              {totalProfit >= 0 ? "+" : ""}
                              {fmtMoney(totalProfit)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between text-zinc-500">
                          <span>Store total before cost</span>
                          <span>{fmtMoney(storeRevenue)}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-between text-zinc-500">
                      <span>Order total</span>
                      <span>{fmtMoney(total)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </SectionCard>

          {order.fulfillment === "ship" && (
            <SectionCard title="Shipping">
              <div className="space-y-0">
                {shippingAddr ? (
                  <>
                    <DetailRow label="Recipient">{shippingAddr.name ?? "-"}</DetailRow>
                    {shippingAddr.phone && (
                      <DetailRow label="Phone">{shippingAddr.phone}</DetailRow>
                    )}
                    <DetailRow label="Address">
                      {[
                        shippingAddr.line1,
                        shippingAddr.line2,
                        shippingAddr.city,
                        shippingAddr.state,
                        shippingAddr.postal_code,
                        shippingAddr.country,
                      ]
                        .filter(Boolean)
                        .join(", ") || "-"}
                    </DetailRow>
                  </>
                ) : (
                  <>
                    <DetailRow label="Recipient">-</DetailRow>
                    <DetailRow label="Address">Missing shipping address</DetailRow>
                  </>
                )}
                <DetailRow label="Carrier">{order.shipping_carrier ?? "-"}</DetailRow>
                <DetailRow label="Tracking #">{order.tracking_number ?? "-"}</DetailRow>
                {order.label_created_at && (
                  <DetailRow label="Label created">
                    {fmtDate(order.label_created_at)}
                  </DetailRow>
                )}
                {order.label_url && (
                  <DetailRow label="Label">
                    <a
                      href={order.label_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-red-400 hover:text-red-300"
                    >
                      Download <ExternalLink className="h-3 w-3" />
                    </a>
                  </DetailRow>
                )}
              </div>
            </SectionCard>
          )}

          {paymentAttemptMade && (
            <SectionCard title="Payment Method">
              {!paymentTx ? (
                <p className="text-sm text-zinc-500">
                  No payment data available for this order.
                </p>
              ) : (
                <div className="space-y-0">
                  <DetailRow label="Card type">{paymentTx.card_type ?? "-"}</DetailRow>
                  <DetailRow label="Payment method">
                    {paymentMethodLabel(paymentTx.payment_method) ?? "Not recorded"}
                  </DetailRow>
                  <DetailRow label="Last 4">
                    {paymentTx.card_last4 ? `.... ${paymentTx.card_last4}` : "-"}
                  </DetailRow>
                  <DetailRow label="Expires">
                    {paymentTx.card_expiry_month && paymentTx.card_expiry_year
                      ? `${String(paymentTx.card_expiry_month).padStart(2, "0")} / ${paymentTx.card_expiry_year}`
                      : "-"}
                  </DetailRow>
                  <DetailRow label="Cardholder">
                    {paymentTx.billing_name ?? "-"}
                  </DetailRow>
                  <DetailRow label="CVV check">
                    <span className={getCvvLabel(paymentTx.cvv2_result_code).color}>
                      {getCvvLabel(paymentTx.cvv2_result_code).label}
                    </span>
                  </DetailRow>
                  <DetailRow label="AVS result">
                    <span className={getAvsLabel(paymentTx.avs_result_code).color}>
                      {getAvsLabel(paymentTx.avs_result_code).label}
                    </span>
                  </DetailRow>
                  {paymentTx.three_ds_status && (
                    <DetailRow label="3D Secure">{paymentTx.three_ds_status}</DetailRow>
                  )}
                  <DetailRow label="Billing address">
                    {[
                      paymentTx.billing_address,
                      paymentTx.billing_city,
                      paymentTx.billing_state,
                      paymentTx.billing_zip,
                      paymentTx.billing_country,
                    ]
                      .filter(Boolean)
                      .join(", ") || "-"}
                  </DetailRow>
                </div>
              )}
            </SectionCard>
          )}

          {isOrderPlaced && (
            <SectionCard title="Email Checklist">
              {!auditAvailable && (
                <p role="alert">
                  Email history unavailable.{" "}
                  <button type="button" disabled={read.pending} onClick={read.retry}>
                    Check email log
                  </button>
                </p>
              )}

              <p className="-mt-2 mb-4 text-xs text-zinc-600">
                {isPickup ? "Pickup order" : "Shipping order"} - Expected emails
              </p>
              <div className="space-y-0">
                {checklistTypes.map((emailType) => {
                  const meta = getEmailTypeMeta(emailType);
                  const matchingLogs = emailLogs.filter(
                    (log) => log.email_type === emailType,
                  );
                  const latestLog =
                    matchingLogs.length > 0
                      ? [...matchingLogs].sort(
                          (a, b) =>
                            new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
                        )[0]
                      : null;

                  const statusEl = latestLog ? (
                    latestLog.delivery_status === "delivered" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle className="h-3 w-3" /> Delivered
                      </span>
                    ) : latestLog.delivery_status === "failed" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-400">
                        <XCircle className="h-3 w-3" /> Failed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                        <Clock className="h-3 w-3" />{" "}
                        {latestLog.delivery_status === "pending" ? "Pending" : "Sent"}
                      </span>
                    )
                  ) : (
                    <span className="text-xs text-zinc-600">
                      {auditAvailable ? "Not sent" : "Unknown"}
                    </span>
                  );

                  const isResending = resendingEmail === emailType;
                  const key = "email:" + order.id + ":" + emailType;
                  const needsCheck =
                    !isResending && !!(uncertain[emailType] || pendingProviderCheck(key));
                  const pendingAudit = matchingLogs.some(
                    (log) => log.delivery_status === "pending",
                  );
                  return (
                    <div
                      key={emailType}
                      className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/50 py-3 last:border-0"
                    >
                      <div>
                        <p className="text-sm text-white">{meta.label}</p>
                        {latestLog && (
                          <p className="mt-0.5 text-xs text-zinc-500">
                            {fmtDate(latestLog.sent_at, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        )}
                        <div className="mt-0.5">{statusEl}</div>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        {(needsCheck || pendingAudit) && auditAvailable && (
                          <button
                            type="button"
                            disabled={read.pending}
                            onClick={read.retry}
                          >
                            Check email log
                          </button>
                        )}
                        {needsCheck && (
                          <span className="text-xs">Resend outcome unconfirmed.</span>
                        )}
                        {needsCheck &&
                          !pendingAudit &&
                          auditAvailable &&
                          !read.pending &&
                          !read.error && (
                            <ResolveEmailCheck
                              key={latestLog?.id + ":" + latestLog?.delivery_status}
                              onResolve={() => {
                                rememberProviderCheck(key, null);
                                setUncertain((prev) => {
                                  const next = { ...prev };
                                  delete next[emailType];
                                  return next;
                                });
                                setToast({
                                  message: "Email check resolved.",
                                  tone: "info",
                                });
                              }}
                            />
                          )}
                        {latestLog?.html_snapshot && (
                          <button
                            type="button"
                            aria-haspopup="dialog"
                            onClick={(event) => {
                              setPreviewInvoker(event.currentTarget);
                              setEmailPreview(latestLog);
                            }}
                            className="text-xs text-zinc-400 transition-colors hover:text-white"
                          >
                            View
                          </button>
                        )}
                        {latestLog && (
                          <ActionButton
                            type="button"
                            onClick={() => {
                              void command.run(() =>
                                handleResendEmail(emailType, latestLog.id),
                              );
                            }}
                            disabled={
                              read.pending ||
                              !!read.error ||
                              command.pending ||
                              !auditAvailable ||
                              pendingAudit ||
                              needsCheck
                            }
                            aria-busy={isResending}
                            className="flex items-center gap-1 text-xs text-red-400 transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${isResending ? "animate-spin" : ""}`}
                            />
                            {isResending ? "Sending..." : "Resend"}
                          </ActionButton>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}
        </div>

        <div className="space-y-6">
          <SectionCard title="Details">
            <div className="space-y-0">
              <DetailRow label="Order #">
                <span className="font-mono">#{order.id.slice(0, 8)}</span>
              </DetailRow>
              <DetailRow label="Status">{statusMeta.label}</DetailRow>
              <DetailRow label="Fulfillment">
                {isPickup ? "Pickup" : "Shipping"}
              </DetailRow>
              <DetailRow label="Created">{fmtDate(order.created_at)}</DetailRow>
              <DetailRow label="Updated">{fmtDate(order.updated_at)}</DetailRow>
              {paymentTx?.customer_ip && (
                <DetailRow label="Customer IP">{paymentTx.customer_ip}</DetailRow>
              )}
              {refundedCents > 0 && (
                <DetailRow label="Refunded">
                  {fmtMoney(refundedAmount)}
                  {order.refunded_at ? ` · ${fmtDate(order.refunded_at)}` : ""}
                </DetailRow>
              )}
              {order.shipping_carrier && (
                <DetailRow label="Carrier">{order.shipping_carrier}</DetailRow>
              )}
              {order.tracking_number && (
                <DetailRow label="Tracking #">{order.tracking_number}</DetailRow>
              )}
              {order.failure_reason && (
                <DetailRow label="Failure reason">{order.failure_reason}</DetailRow>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Customer">
            <div className="space-y-0">
              {customerSummary && (
                <DetailRow label="Customer ID">
                  <span className="font-mono text-xs text-zinc-500">
                    {customerSummary.displayId}
                  </span>
                </DetailRow>
              )}
              <DetailRow label="Name">{customerName}</DetailRow>
              <DetailRow label="Email">{customerEmail ?? "-"}</DetailRow>
              <DetailRow label="Phone">{customerPhone ?? "-"}</DetailRow>
              <DetailRow label="Checkout">
                {order.user_id ? "Registered customer" : "Guest checkout"}
              </DetailRow>
              {!isPickup && (
                <DetailRow label="Recipient">
                  {shippingAddr?.name ?? customerName}
                </DetailRow>
              )}
              {paymentTx?.billing_name &&
                paymentTx.billing_name !== customerName &&
                paymentTx.billing_name !== shippingAddr?.name && (
                  <DetailRow label="Billing name">{paymentTx.billing_name}</DetailRow>
                )}
            </div>
          </SectionCard>
        </div>
      </div>

      {emailPreview && (
        <ModalPortal
          open
          label="Email preview"
          invoker={previewInvoker}
          onClose={() => setEmailPreview(null)}
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col border border-zinc-800 bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">
                  {getEmailTypeMeta(emailPreview.email_type).label}
                </p>
                <p className="text-xs text-zinc-500">{emailPreview.subject}</p>
              </div>
              <button
                type="button"
                aria-label="Close email preview"
                onClick={() => setEmailPreview(null)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe
                srcDoc={emailPreview.html_snapshot ?? ""}
                title="Email preview"
                className="h-full min-h-[500px] w-full"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </ModalPortal>
      )}

      <AdminOrderItemDetailsModal
        open={itemModalOpen}
        item={selectedItem}
        invoker={itemInvoker}
        showProfit={showOrderProfit && !Boolean(selectedItem?.refunded_at)}
        onClose={() => {
          setItemModalOpen(false);
          setSelectedItem(null);
        }}
      />

      {toast && (
        <Toast
          open={Boolean(toast)}
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      )}
    </AdminPage>
  );
}

function ResolveEmailCheck({ onResolve }: { onResolve: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="space-y-2 text-xs">
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        I verified this resend with the email provider.
      </label>
      <button
        type="button"
        className="min-h-11 px-2 underline"
        disabled={!checked}
        onClick={onResolve}
      >
        Resolve email check
      </button>
    </div>
  );
}
