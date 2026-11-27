import { parseReportLocation, REPORT_SORTS } from "../ReportContract/filters";
import type {
  CalendarRange,
  ReportFilters,
  ReportId,
  ReportRequest,
} from "../ReportContract/types";

export const reportNames: Record<ReportId, string> = {
  overview: "Overview",
  sales: "Sales & revenue",
  customers: "Customers",
  acquisition: "Acquisition",
  products: "Products",
  payments: "Payments",
  health: "Checkout health",
};

export const filterNames = {
  device: "Device",
  source: "Source",
  channel: "Channel",
  campaign: "Campaign",
  paymentMethod: "Payment method",
  fulfillment: "Fulfillment",
  productId: "Product",
  variantId: "Variant",
  brandId: "Brand",
  categoryId: "Category",
  sizeId: "Size",
  customer: "Customer",
  status: "Status",
} satisfies Record<keyof ReportFilters, string>;

const knownLabels: Record<string, string> = {
  applePay: "Apple Pay",
  googlePay: "Google Pay",
  cashAppPay: "Cash App Pay",
  card: "Card",
  afterpay: "Afterpay",
  ship: "Shipping",
  pickup: "Pickup",
  activity: "Activity date",
  "order-cohort": "Order cohort",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

export function filterLabel(value: string): string {
  return (
    knownLabels[value] ??
    value.replace(/[\s_-]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())
  );
}

export type DashboardLocation = Omit<ReturnType<typeof parseReportLocation>, "apiParams">;
export type DashboardChange = Partial<Omit<ReportRequest, "range">> & {
  range?: CalendarRange;
  attribution?: DashboardLocation["attribution"];
};

export function readDashboardLocation(
  params: URLSearchParams,
  now: Date,
): DashboardLocation {
  const { request, attribution } = parseReportLocation(params, now);
  return { request, attribution };
}

export function reportParams(
  { request, attribution }: DashboardLocation,
  includePresentation = false,
): URLSearchParams {
  const { report, range, compare, bucket, dateBasis, page, pageSize, sort } = request;
  const params = new URLSearchParams({
    report,
    from: range.from,
    to: range.to,
    timezone: range.timezone,
    compare: String(compare),
    bucket,
    dateBasis,
    page: String(page),
    pageSize: String(pageSize),
    sort,
  });
  for (const key of Object.keys(filterNames) as Array<keyof ReportFilters>) {
    const value = request[key];
    if (value !== undefined) params.set(key, value);
  }
  if (includePresentation && report === "acquisition")
    params.set("attribution", attribution);
  return params;
}

export function changeDashboardLocation(
  current: DashboardLocation,
  change: DashboardChange,
  now: Date,
) {
  const params = reportParams(current, true);
  const { range, ...fields } = change;
  if (range) {
    params.set("from", range.from);
    params.set("to", range.to);
    params.set("timezone", range.timezone);
  }
  if (fields.report && fields.report !== current.request.report) {
    params.set("sort", REPORT_SORTS[fields.report][0]);
    params.delete("attribution");
  }
  const resetPage =
    Boolean(range) ||
    Object.keys(fields).some((key) => key !== "page" && key !== "attribution");
  if (resetPage) params.set("page", "1");
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) params.delete(key);
    else params.set(key, String(value));
  }
  return readDashboardLocation(params, now);
}

export function createRequestGuard() {
  let current: AbortController | undefined;
  return {
    start() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return { signal: controller.signal, isCurrent: () => current === controller };
    },
    cancel() {
      current?.abort();
      current = undefined;
    },
  };
}
