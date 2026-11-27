import { z } from "zod";

import {
  countCalendarBuckets,
  getDefaultCalendarRange,
  resolveCalendarRange,
} from "./calendar-range";
import {
  REPORT_FILTER_VALUES,
  REPORT_IDS,
  REPORT_TIMEZONE,
  type ReportBucket,
  type ReportId,
  type ReportRequest,
  type ResolvedRange,
} from "./types";

export const DEFAULT_REPORT_ID = "overview" satisfies ReportId;
export const DEFAULT_REPORT_PAGE_SIZE = 50;
export const MAX_REPORT_PAGE_SIZE = 100;
export const MAX_REPORT_OFFSET = 100_000;
export const MAX_REPORT_BUCKETS = 2_000;

export const REPORT_SORTS = {
  overview: ["netMerchandise", "confirmedOrders", "sessions"],
  sales: ["confirmedOrders", "netMerchandise", "averageOrderValue"],
  customers: ["buyers", "visitors", "sessions", "observedLifetimeSpend"],
  acquisition: ["sessions", "purchasingSessions", "confirmedOrders", "revenue"],
  products: ["netMerchandise", "units", "netUnits", "views", "confirmedOrders"],
  payments: ["paidOrders", "revenue", "successRate", "fees"],
  health: ["count", "state"],
} as const satisfies Record<ReportId, readonly [string, ...string[]]>;

const slug = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) =>
      /^[a-z0-9]/i.test(value) &&
      !/[^a-z0-9_-]|[a-z0-9]{24,}|token|secret|password|auth|session|key/i.test(value),
  )
  .transform((value) => value.toLowerCase());

const uuid = z
  .string()
  .length(36)
  .pipe(z.uuid())
  .transform((value) => value.toLowerCase());

const positiveInteger = z
  .string()
  .max(16)
  .refine((value) => /^[1-9]/.test(value) && !/\D/.test(value))
  .transform(Number)
  .refine(Number.isSafeInteger);

const requestSchema = z.object({
  report: z.enum(REPORT_IDS).default(DEFAULT_REPORT_ID),
  from: z.string().length(10).optional(),
  to: z.string().length(10).optional(),
  timezone: z.literal(REPORT_TIMEZONE).default(REPORT_TIMEZONE),
  compare: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  bucket: z.enum(REPORT_FILTER_VALUES.bucket).optional(),
  dateBasis: z.enum(REPORT_FILTER_VALUES.dateBasis).default("activity"),
  page: positiveInteger.default(1),
  pageSize: positiveInteger
    .pipe(z.number().max(MAX_REPORT_PAGE_SIZE))
    .default(DEFAULT_REPORT_PAGE_SIZE),
  sort: z.string().max(30).optional(),
  device: z.enum(REPORT_FILTER_VALUES.device).optional(),
  source: slug.optional(),
  channel: slug.optional(),
  campaign: slug.optional(),
  paymentMethod: z.enum(REPORT_FILTER_VALUES.paymentMethod).optional(),
  fulfillment: z.enum(REPORT_FILTER_VALUES.fulfillment).optional(),
  productId: uuid.optional(),
  variantId: uuid.optional(),
  brandId: uuid.optional(),
  categoryId: uuid.optional(),
  sizeId: uuid.optional(),
  customer: z.enum(REPORT_FILTER_VALUES.customer).optional(),
  status: z.enum(REPORT_FILTER_VALUES.status).optional(),
});

const acceptedFields = new Set(Object.keys(requestSchema.shape));

export function isReportFilterValue(
  key:
    | "source"
    | "channel"
    | "campaign"
    | "productId"
    | "variantId"
    | "brandId"
    | "categoryId"
    | "sizeId",
  value: string,
) {
  const parsed = requestSchema.shape[key].safeParse(value);
  return parsed.success && parsed.data === value;
}

function defaultBucket(calendarDays: number): ReportBucket {
  if (calendarDays <= 90) return "day";
  if (calendarDays <= 365) return "week";
  return "month";
}

function enforceBucketLimit(
  range: ResolvedRange,
  bucket: ReportBucket,
  compare: boolean,
): void {
  const fits = (candidate: ReportBucket, includeComparison = compare) => {
    const { selected, comparison } = countCalendarBuckets(range, candidate);
    return (
      selected <= MAX_REPORT_BUCKETS &&
      (!includeComparison || comparison <= MAX_REPORT_BUCKETS)
    );
  };
  if (fits(bucket)) {
    return;
  }

  const buckets = REPORT_FILTER_VALUES.bucket;
  const alternatives = buckets
    .slice(buckets.indexOf(bucket) + 1)
    .filter((candidate) => fits(candidate));
  let guidance = "Choose a shorter date range.";
  if (alternatives.length > 0) {
    guidance = `Choose ${alternatives.join(" or ")} buckets.`;
  } else if (compare && fits(bucket, false)) {
    guidance = "Turn off comparison or choose a shorter date range.";
  }

  const limit = MAX_REPORT_BUCKETS.toLocaleString("en-US");
  throw new RangeError(
    `The selected dates exceed the ${limit}-bucket limit per series. ${guidance}`,
  );
}

/** Browser URL projection. The selected acquisition view never changes the shared report/cache key. */
export function parseReportLocation(input: URLSearchParams, now: Date) {
  const params = new URLSearchParams(input);
  const values = params.getAll("attribution");
  if (
    values.length > 1 ||
    (values.length &&
      (params.get("report") !== "acquisition" ||
        !["discovery", "purchase-session"].includes(values[0])))
  )
    throw new RangeError("Invalid acquisition view.");
  params.delete("attribution");
  return {
    request: parseReportRequest(params, now),
    attribution:
      values[0] === "discovery" ? ("discovery" as const) : ("purchase-session" as const),
    apiParams: params,
  };
}
export function parseReportRequest(input: URLSearchParams, now: Date): ReportRequest {
  const fields = new Map<string, string>();
  for (const [key, value] of input) {
    if (!acceptedFields.has(key) || fields.has(key)) {
      throw new RangeError("Unsupported or repeated report parameter.");
    }
    fields.set(key, value);
  }

  const parsed = requestSchema.safeParse(Object.fromEntries(fields));
  if (!parsed.success) {
    throw new RangeError("Invalid report parameters.");
  }

  const {
    report,
    from,
    to,
    timezone,
    compare,
    bucket,
    dateBasis,
    page,
    pageSize,
    sort,
    ...filters
  } = parsed.data;
  if ((from === undefined) !== (to === undefined)) {
    throw new RangeError("Provide both report dates.");
  }
  if ((page - 1) * pageSize > MAX_REPORT_OFFSET) {
    throw new RangeError("Report page is out of range.");
  }

  const sorts: readonly string[] = REPORT_SORTS[report];
  if (sort !== undefined && !sorts.includes(sort)) {
    throw new RangeError("Invalid sort for this report.");
  }

  const calendar =
    from !== undefined && to !== undefined
      ? { from, to, timezone }
      : getDefaultCalendarRange(now);
  const range = resolveCalendarRange(calendar, now);
  const effectiveBucket = bucket ?? defaultBucket(range.calendarDays);
  enforceBucketLimit(range, effectiveBucket, compare);
  return {
    ...filters,
    report,
    range,
    compare,
    bucket: effectiveBucket,
    dateBasis,
    page,
    pageSize,
    sort: sort ?? REPORT_SORTS[report][0],
  };
}
