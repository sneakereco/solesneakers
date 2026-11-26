export const REPORT_IDS = [
  "overview",
  "sales",
  "customers",
  "acquisition",
  "products",
  "payments",
  "health",
] as const;

export const REPORT_TIMEZONE = "America/New_York";

export const REPORT_FILTER_VALUES = {
  bucket: ["day", "week", "month"],
  dateBasis: ["activity", "order-cohort"],
  device: ["mobile", "desktop", "tablet", "unknown"],
  paymentMethod: ["card", "applePay", "googlePay", "afterpay", "cashAppPay", "unknown"],
  fulfillment: ["ship", "pickup"],
  customer: ["new", "returning"],
  status: [
    "pending",
    "processing",
    "paid",
    "shipped",
    "canceled",
    "refunded",
    "partially_refunded",
    "refund_pending",
    "refund_failed",
    "failed",
    "blocked",
    "review",
  ],
} as const;

type FilterValue<Key extends keyof typeof REPORT_FILTER_VALUES> =
  (typeof REPORT_FILTER_VALUES)[Key][number];

export type ReportId = (typeof REPORT_IDS)[number];
export type ReportBucket = FilterValue<"bucket">;
export type DateBasis = FilterValue<"dateBasis">;
export type Device = FilterValue<"device">;
export type PaymentMethod = FilterValue<"paymentMethod">;

export type CalendarRange = {
  from: string;
  to: string;
  timezone: typeof REPORT_TIMEZONE;
};

export type ResolvedRange = CalendarRange & {
  startInclusive: string;
  endExclusive: string;
  calendarDays: number;
  comparisonStartInclusive: string;
  comparisonEndExclusive: string;
  partial: boolean;
};

export type ReportFilters = {
  device?: Device;
  source?: string;
  channel?: string;
  campaign?: string;
  paymentMethod?: PaymentMethod;
  fulfillment?: FilterValue<"fulfillment">;
  productId?: string;
  variantId?: string;
  brandId?: string;
  categoryId?: string;
  sizeId?: string;
  customer?: FilterValue<"customer">;
  status?: FilterValue<"status">;
};

export type ReportRequest = ReportFilters & {
  report: ReportId;
  range: ResolvedRange;
  compare: boolean;
  bucket: ReportBucket;
  dateBasis: DateBasis;
  page: number;
  pageSize: number;
  sort: string;
};

export type MoneyValue = {
  cents: number | null;
  complete: boolean;
  missingCount: number;
};

export type PublicDatasetScope = {
  datasetId: string;
  storefront: "sole";
  environment: "staging" | "production";
  currency: "USD";
};

export type ReportScope = {
  dataset: PublicDatasetScope | null;
  dateBasis: DateBasis;
  filters: ReportFilters;
  attribution: {
    orderScope: "all-orders" | "filtered-orders";
    eligibleOrders: number | null;
    attributedOrders: number | null;
    unattributedOrders: number | null;
  };
};

export type CoverageIssue = {
  code:
    | "before-dataset-start"
    | "component-unavailable"
    | "incomplete-coverage"
    | "inapplicable-filter"
    | "unverified-ingestion";
  message: string;
  metric?: string;
  filter?: keyof ReportFilters;
  missingCount?: number;
};

export type ReportEnvelope<T> = {
  range: ResolvedRange;
  scope: ReportScope;
  asOf: string;
  ingestionAsOf: string | null;
  behaviorThrough: string | null;
  datasetStartedAt: string | null;
  coverage: CoverageIssue[];
} & (
  | { state: "ready" | "empty" | "stale"; data: T }
  | { state: "unavailable" | "unconfigured"; data: null }
);

export type PaginatedRows<Row> = {
  rows: Row[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export type Rate = {
  numerator: number | null;
  denominator: number | null;
  /** Fraction from 0 to 1 when the denominator is known and nonzero. */
  value: number | null;
};

export type TimeBucket = {
  startInclusive: string;
  endExclusive: string;
  netMerchandise: MoneyValue;
  confirmedOrders: number | null;
  sessions: number | null;
  visitors: number | null;
};

export type FunnelStep = {
  step: "session" | "product-view" | "cart-addition" | "checkout" | "purchase";
  sessions: number | null;
  fromStart: Rate;
  fromPrevious: Rate;
};

export type SourceRow = {
  key: string;
  label: string;
  sessions: number | null;
  purchasingSessions: number | null;
  confirmedOrders: number | null;
  revenue: MoneyValue;
};

type ProductMetrics = {
  confirmedOrders: number | null;
  units: number | null;
  netUnits: number | null;
  views: number | null;
  viewToPurchase: Rate;
  netMerchandise: MoneyValue;
};

type TaxonomyReference = { id: string | null; label: string };

export type ProductRow = ProductMetrics & {
  successfulAdditions: number | null;
  variantSelections: number | null;
  unavailableSizeRequests: number | null;
  stockoutViews: number | null;
  productId: string;
  variantId: string | null;
  name: string;
  brand: TaxonomyReference | null;
  category: TaxonomyReference | null;
  size: TaxonomyReference | null;
  availableUnits: number | null;
};

export type PaymentRow = {
  method: PaymentMethod;
  paidOrders: number | null;
  paidOrderShare: Rate;
  resolvedAttempts: number | null;
  successfulAttempts: number | null;
  failedAttempts: number | null;
  pendingAttempts: number | null;
  successRate: Rate;
  revenue: MoneyValue;
  averageOrderValue: MoneyValue;
  fees: MoneyValue;
};

export type CustomerCohort = {
  month: string;
  buyers: number | null;
  repeatPurchases: Array<{ monthsSinceFirstPurchase: number; repeatPurchaseRate: Rate }>;
};

export type SalesComponents = {
  grossMerchandise: MoneyValue;
  discounts: MoneyValue;
  merchandiseRefunds: MoneyValue;
  shippingCollected: MoneyValue;
  shippingRefunds: MoneyValue;
  taxCollected: MoneyValue;
  taxRefunds: MoneyValue;
  unallocatedRefunds: MoneyValue;
  netMerchandise: MoneyValue;
  netShipping: MoneyValue;
  netTax: MoneyValue;
  totalCollected: MoneyValue;
};

export type OverviewSummary = {
  netMerchandise: MoneyValue;
  confirmedOrders: number | null;
  averageOrderValue: MoneyValue;
  conversion: Rate;
  visitors: number | null;
  sessions: number | null;
  buyers: number | null;
};
export type OverviewData = {
  summary: OverviewSummary;
  comparison: OverviewSummary | null;
  series: TimeBucket[];
  comparisonSeries: TimeBucket[] | null;
  funnel: FunnelStep[];
  leadingSources: SourceRow[];
  leadingProducts: ProductRow[];
  components: SalesComponents;
};

export type SalesPeriod = SalesComponents & {
  buyers: { known: number; missingOrders: number };
  attribution: { eligibleOrders: number; attributedOrders: number };
  /** Confirmed orders whose original reconciled merchandise value is unavailable. */
  missingOrderValues: number;
  missingReturnQuantities: number;
  confirmedOrders: number | null;
  averageOrderValue: MoneyValue;
  medianOrderValue: MoneyValue;
  orderValueBins: Array<{
    minimumCents: number;
    maximumCentsExclusive: number | null;
    confirmedOrders: number;
  }>;
  units: number | null;
  netUnits: number | null;
  recordedCogs: MoneyValue;
  recordedProfit: MoneyValue;
  costCoverage: { revenue: Rate; orders: Rate; lines: Rate };
  shippingContribution: MoneyValue;
  fees: MoneyValue;
};

export type SalesData = SalesPeriod & {
  series: TimeBucket[];
  comparisonSeries: TimeBucket[] | null;
  comparison: SalesPeriod | null;
};

export type CustomerPeriod = {
  attribution: SalesPeriod["attribution"] | null;
  visitors: number | null;
  sessions: number | null;
  buyers: number | null;
  newBuyers: number | null;
  returningBuyers: number | null;
  observedLifetimeSpend: MoneyValue;
  selectedPeriodSpend: MoneyValue;
  missingBuyerOrders: number | null;
  cohorts: CustomerCohort[] | null;
  devices: PaginatedRows<{ device: Device; visitors: number; sessions: number }> | null;
};

export type CustomersData = CustomerPeriod & {
  activeFiveMinuteVisitors: number | null;
  activeWindow: { start: string; end: string } | null;
  comparison: CustomerPeriod | null;
};

export type AttributionBreakdown = {
  attribution: SalesPeriod["attribution"];
  series: TimeBucket[];
  sources: PaginatedRows<SourceRow>;
  channels: PaginatedRows<SourceRow>;
  campaigns: PaginatedRows<SourceRow>;
  placements: PaginatedRows<SourceRow>;
};

export type AcquisitionPeriod = {
  discovery: AttributionBreakdown;
  purchaseSession: AttributionBreakdown;
};

export type AcquisitionData = AcquisitionPeriod & {
  comparison: AcquisitionPeriod | null;
};

export type ProductBreakdownRow = ProductMetrics & TaxonomyReference;

export type ProductPeriod = {
  attribution: SalesPeriod["attribution"];
  products: PaginatedRows<ProductRow>;
  variants: PaginatedRows<ProductRow>;
  brands: PaginatedRows<ProductBreakdownRow>;
  categories: PaginatedRows<ProductBreakdownRow>;
  sizes: PaginatedRows<ProductBreakdownRow>;
  unmetDemand: {
    stockoutSignals: number | null;
    unavailableSizeSelections: number | null;
    searchesWithNoResults: number | null;
    searches: number | null;
    variantSelections: number | null;
  };
};

export type ProductsData = ProductPeriod & {
  inventory: {
    scope: "recorded-variants";
    recordedVariants: number;
    missingStockVariants: number;
    catalogVariants: null;
    asOf: string | null;
    availableUnits: number | null;
    inStockVariants: number | null;
    outOfStockVariants: number | null;
  };
  comparison: ProductPeriod | null;
};
export type PaymentsPeriod = {
  attribution: SalesPeriod["attribution"];
  methods: PaginatedRows<PaymentRow>;
  paidOrders: number | null;
  resolvedAttempts: number | null;
  pendingAttempts: number | null;
};

export type PaymentsData = PaymentsPeriod & { comparison: PaymentsPeriod | null };

export type HealthPeriod = {
  attribution: SalesPeriod["attribution"];
  fulfillmentDateBasis: "latest-state-of-orders-confirmed-in-range";
  missingFulfillmentStates: number;
  missingFulfillmentDurations: number;
  funnel: FunnelStep[];
  outcomes: Array<{ stage: string; outcome: string; reason: string; count: number }>;
  fulfillmentPreference: { ship: number; pickup: number; unknown: number } | null;
  backlog: Array<{
    fulfillment: FilterValue<"fulfillment">;
    state: string;
    count: number;
  }>;
  paymentToFulfillment: Array<{
    fulfillment: FilterValue<"fulfillment">;
    fulfilledOrders: number;
    medianSeconds: number | null;
    p90Seconds: number | null;
  }>;
};

export type HealthData = HealthPeriod & { comparison: HealthPeriod | null };

export type ReportDataMap = {
  overview: OverviewData;
  sales: SalesData;
  customers: CustomersData;
  acquisition: AcquisitionData;
  products: ProductsData;
  payments: PaymentsData;
  health: HealthData;
};
