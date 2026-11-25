import { parseReportRequest } from "../../../ReportContract/filters";

const now = new Date("2026-11-25T12:00:00Z");
const uuid = "a754a24d-a657-4522-93d6-3d4b20879f05";

it("roundtrips_all_filter_values", () => {
  const params = new URLSearchParams({
    report: "products",
    from: "2025-12-30",
    to: "2026-01-02",
    timezone: "America/New_York",
    compare: "true",
    bucket: "month",
    dateBasis: "order-cohort",
    page: "2",
    pageSize: "100",
    sort: "netUnits",
    device: "unknown",
    source: "unknown",
    channel: "Email",
    campaign: "Holiday-2025",
    paymentMethod: "unknown",
    fulfillment: "pickup",
    productId: uuid.toUpperCase(),
    variantId: uuid,
    brandId: uuid,
    categoryId: uuid,
    sizeId: uuid,
    customer: "returning",
    status: "partially_refunded",
  });

  expect(parseReportRequest(new URLSearchParams(params.toString()), now)).toEqual({
    report: "products",
    range: {
      from: "2025-12-30",
      to: "2026-01-02",
      timezone: "America/New_York",
      startInclusive: "2025-12-30T05:00:00.000Z",
      endExclusive: "2026-01-03T05:00:00.000Z",
      calendarDays: 4,
      comparisonStartInclusive: "2025-12-26T05:00:00.000Z",
      comparisonEndExclusive: "2025-12-30T05:00:00.000Z",
      partial: false,
    },
    compare: true,
    bucket: "month",
    dateBasis: "order-cohort",
    page: 2,
    pageSize: 100,
    sort: "netUnits",
    device: "unknown",
    source: "unknown",
    channel: "email",
    campaign: "holiday-2025",
    paymentMethod: "unknown",
    fulfillment: "pickup",
    productId: uuid,
    variantId: uuid,
    brandId: uuid,
    categoryId: uuid,
    sizeId: uuid,
    customer: "returning",
    status: "partially_refunded",
  });
});

it("defaults to thirty inclusive store days and leaves filters absent", () => {
  const request = parseReportRequest(new URLSearchParams(), now);

  expect(request).toMatchObject({
    report: "overview",
    range: { from: "2026-10-27", to: "2026-11-25", calendarDays: 30, partial: true },
    compare: false,
    bucket: "day",
    dateBasis: "activity",
    page: 1,
    pageSize: 50,
    sort: "netMerchandise",
  });
  expect(request).not.toHaveProperty("device");
  expect(request).not.toHaveProperty("source");
  expect(request).not.toHaveProperty("paymentMethod");
});

it("chooses a monthly bucket for multi-year windows with their original dates", () => {
  const request = parseReportRequest(
    new URLSearchParams({ from: "2023-01-01", to: "2026-11-25" }),
    now,
  );
  expect(request.bucket).toBe("month");
  expect(request.range).toMatchObject({ from: "2023-01-01", to: "2026-11-25" });
});

it.each([
  "report=arbitrary",
  "sort=successRate&report=sales",
  "report=sales&report=overview",
  "sql=SELECT",
  "projectId=123",
  "provider=other",
  "datasetId=staging",
  "environment=staging",
  "__proto__=ignored",
  "page=0",
  "page=1.25",
  "page=1%0A",
  "page=9007199254740991&pageSize=100",
  "pageSize=101",
  "bucket=hour",
  "source=someone%40example.com",
  "campaign=campaign%0A",
  "source=google%2Ftest",
  `channel=${"x".repeat(65)}`,
  "brandId=not-a-uuid",
  "status=unexpected",
  "compare=maybe",
  "timezone=UTC",
  "from=2026-11-24",
])("rejects invalid or unsupported query parameters (%s)", (query) => {
  expect(() => parseReportRequest(new URLSearchParams(query), now)).toThrow(RangeError);
});
