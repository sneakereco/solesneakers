import {
  calendarPreset,
  readCalendarDraft,
} from "../../../Source/Features/Dashboard/calendar-draft";
import { formatMoney } from "../../../Source/Features/Dashboard/format";
import {
  createRequestGuard,
  readDashboardLocation,
  reportParams,
} from "../../../Source/Features/Dashboard/request-state";

const now = new Date("2026-11-26T02:00:00Z");

test("presets end on the store's local day and include both endpoints", () => {
  expect(calendarPreset("30", now)).toEqual({
    from: "2026-10-27",
    to: "2026-11-25",
    timezone: "America/New_York",
  });
  expect(calendarPreset("month", now).from).toBe("2026-11-01");
});

test("fall comparison counts local days while day boundaries preserve their offsets", () => {
  expect(readCalendarDraft("2026-10-31", "2026-11-02", now)).toMatchObject({
    calendarDays: 3,
    startInclusive: "2026-10-31T04:00:00.000Z",
    endExclusive: "2026-11-03T05:00:00.000Z",
    comparisonStartInclusive: "2026-10-28T04:00:00.000Z",
  });
});

test("direct entry distinguishes a valid leap day from missing or invalid endpoints", () => {
  expect(readCalendarDraft("2024-02-29", "2024-02-29", now)?.calendarDays).toBe(1);
  expect(readCalendarDraft("2025-02-29", "2025-03-02", now)).toBeNull();
  expect(readCalendarDraft("2026-11-19", "", now)).toBeNull();
  expect(readCalendarDraft("2026-11-24", "2026-11-26", now)).toBeNull();
  expect(readCalendarDraft("2025-12-31", "2026-01-01", now)?.calendarDays).toBe(2);
});

test("preserves exact formatted cents at both ends of the safe integer domain", () => {
  // On Node 24, converting the maximum safe integer to floating dollars formats as .90.
  expect(
    formatMoney({ cents: Number.MAX_SAFE_INTEGER, complete: true, missingCount: 0 }),
  ).toBe("$90,071,992,547,409.91");
  expect(
    formatMoney({ cents: -Number.MAX_SAFE_INTEGER, complete: true, missingCount: 0 }),
  ).toBe("-$90,071,992,547,409.91");
  expect(formatMoney({ cents: -1, complete: true, missingCount: 0 })).toBe("-$0.01");
  expect(formatMoney({ cents: 0, complete: true, missingCount: 0 })).toBe("$0.00");
  expect(formatMoney({ cents: null, complete: false, missingCount: 1 })).toBe(
    "Unavailable",
  );
});

test("round trips every report selector while keeping acquisition presentation out of the API", () => {
  const query = new URLSearchParams({
    report: "acquisition",
    from: "2026-11-03",
    to: "2026-11-19",
    compare: "true",
    bucket: "week",
    dateBasis: "order-cohort",
    page: "2",
    pageSize: "25",
    sort: "revenue",
    device: "unknown",
    source: "social",
    channel: "organic-social",
    campaign: "holidays",
    paymentMethod: "applePay",
    fulfillment: "pickup",
    customer: "returning",
    status: "paid",
    productId: "00000000-0000-4000-a000-000000000001",
    variantId: "00000000-0000-4000-a000-000000000002",
    brandId: "00000000-0000-4000-a000-000000000003",
    categoryId: "00000000-0000-4000-a000-000000000004",
    sizeId: "00000000-0000-4000-a000-000000000005",
    attribution: "discovery",
  });
  const location = readDashboardLocation(query, now);
  expect(location.attribution).toBe("discovery");
  for (const [key, value] of query) {
    expect(reportParams(location).get(key)).toBe(key === "attribution" ? null : value);
    expect(reportParams(location, true).get(key)).toBe(value);
  }
  expect(() =>
    readDashboardLocation(new URLSearchParams("compare=true&compare=false"), now),
  ).toThrow("Unsupported or repeated report parameter.");
});

test("superseding and clearing report requests rejects their late results", () => {
  const guard = createRequestGuard();
  const a = guard.start();
  const b = guard.start();
  expect(a.signal.aborted).toBe(true);
  expect(a.isCurrent()).toBe(false);
  expect(b.isCurrent()).toBe(true);
  guard.cancel();
  expect(b.signal.aborted).toBe(true);
  expect(b.isCurrent()).toBe(false);
});
