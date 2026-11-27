import { parseReportRequest } from "../../../Source/Features/ReportContract/filters";

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

it.each([
  ["day", "2020-01-01", "2025-06-22", "2025-06-23"],
  ["week", "1988-01-03", "2026-04-26", "2026-04-27"],
  ["month", "1850-01-31", "2016-08-31", "2016-09-01"],
])(
  "enforces the limit on intersected %s buckets",
  (bucket, from, lastValidTo, firstInvalidTo) => {
    expect(
      parseReportRequest(new URLSearchParams({ from, to: lastValidTo, bucket }), now),
    ).toMatchObject({ bucket, range: { from, to: lastValidTo } });

    expect(() =>
      parseReportRequest(new URLSearchParams({ from, to: firstInvalidTo, bucket }), now),
    ).toThrow(/2,000/);
  },
);

it("suggests a valid coarser bucket and preserves the requested long range", () => {
  const from = "1900-01-01";
  const to = "2026-11-25";
  const dates = { from, to };

  expect(() =>
    parseReportRequest(new URLSearchParams({ ...dates, bucket: "day" }), now),
  ).toThrow("Choose month buckets.");
  expect(
    parseReportRequest(new URLSearchParams({ ...dates, bucket: "month" }), now),
  ).toMatchObject({ bucket: "month", range: dates });
  expect(parseReportRequest(new URLSearchParams(dates), now)).toMatchObject({
    bucket: "month",
    range: dates,
  });
});

it("validates the default bucket against the same limit", () => {
  const dates = { from: "1850-01-31", to: "2016-09-01" };
  expect(() => parseReportRequest(new URLSearchParams(dates), now)).toThrow(/2,000/);
});

it("counts weeks in the comparison window independently", () => {
  // The selected dates begin on Tuesday and span 2,000 weeks. The equally
  // long comparison starts on Wednesday and intersects 2,001 weeks.
  const query = new URLSearchParams({
    from: "1988-01-05",
    to: "2026-05-03",
    bucket: "week",
  });
  expect(parseReportRequest(query, now)).toMatchObject({ bucket: "week" });

  query.set("compare", "true");
  expect(() => parseReportRequest(query, now)).toThrow("Choose month buckets.");
});

it("allows up to 2,000 buckets in each of the selected and comparison periods", () => {
  const params = new URLSearchParams({
    from: "2020-01-01",
    to: "2025-06-22",
    bucket: "day",
    compare: "true",
  });

  expect(parseReportRequest(params, now)).toMatchObject({
    compare: true,
    bucket: "day",
    range: { calendarDays: 2000 },
  });
});
