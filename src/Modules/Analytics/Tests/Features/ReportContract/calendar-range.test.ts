import { resolveCalendarRange } from "../../../Source/Features/ReportContract/calendar-range";
import type { CalendarRange } from "../../../Source/Features/ReportContract/types";

const now = new Date("2026-11-25T12:00:00Z");

function range(from: string, to = from): CalendarRange {
  return { from, to, timezone: "America/New_York" };
}

it("handles_23_and_25_hour_local_days", () => {
  expect(resolveCalendarRange(range("2026-03-08"), now)).toMatchObject({
    startInclusive: "2026-03-08T05:00:00.000Z",
    endExclusive: "2026-03-09T04:00:00.000Z",
    calendarDays: 1,
  });
  expect(resolveCalendarRange(range("2026-11-01"), now)).toMatchObject({
    startInclusive: "2026-11-01T04:00:00.000Z",
    endExclusive: "2026-11-02T05:00:00.000Z",
    calendarDays: 1,
  });
});

it("keeps_single_day_inclusive", () => {
  expect(resolveCalendarRange(range("2024-02-29"), now)).toMatchObject({
    from: "2024-02-29",
    to: "2024-02-29",
    startInclusive: "2024-02-29T05:00:00.000Z",
    endExclusive: "2024-03-01T05:00:00.000Z",
    calendarDays: 1,
    partial: false,
  });
});

it.each([
  ["2026-03-02", "2026-03-01"],
  ["2026-11-25", "2026-11-26"],
  ["2026-02-29", "2026-03-01"],
  ["2026-04-01", "2026-04-31"],
  ["2026-4-01", "2026-04-02"],
  ["2026-04-01", "2026-04-02T12:00:00Z"],
])("rejects_reversed_future_and_invalid_dates (%s through %s)", (from, to) => {
  expect(() => resolveCalendarRange(range(from, to), now)).toThrow(RangeError);
});

it("uses the store date to mark the current day partial", () => {
  const localEvening = new Date("2026-11-25T02:00:00Z");

  expect(resolveCalendarRange(range("2026-11-24"), localEvening).partial).toBe(true);
  expect(() => resolveCalendarRange(range("2026-11-25"), localEvening)).toThrow(
    RangeError,
  );
});

it.each([
  ["2026-03-10", "2026-03-12", 3, "2026-03-07T05:00:00.000Z", "2026-03-10T04:00:00.000Z"],
  ["2026-11-02", "2026-11-04", 3, "2026-10-30T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
  ["2025-12-30", "2026-01-02", 4, "2025-12-26T05:00:00.000Z", "2025-12-30T05:00:00.000Z"],
])(
  "compares the immediately preceding local days for %s through %s",
  (from, to, calendarDays, comparisonStartInclusive, comparisonEndExclusive) => {
    expect(resolveCalendarRange(range(from, to), now)).toMatchObject({
      calendarDays,
      comparisonStartInclusive,
      comparisonEndExclusive,
    });
  },
);
