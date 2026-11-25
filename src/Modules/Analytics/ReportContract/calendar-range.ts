import { TZDate } from "@date-fns/tz";

import { REPORT_TIMEZONE, type CalendarRange, type ResolvedRange } from "./types";

const MILLISECONDS_PER_UTC_DAY = 86_400_000;

function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("Report dates must use YYYY-MM-DD.");
  }

  const day = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Invalid report calendar date.");
  }

  return day;
}

function todayInStore(now: Date): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("Invalid report reference time.");
  }

  const local = new TZDate(now.getTime(), REPORT_TIMEZONE);
  const calendarDay = new Date(0);
  calendarDay.setUTCFullYear(local.getFullYear(), local.getMonth(), local.getDate());
  return calendarDay;
}

function shiftCalendarDays(day: Date, days: number): Date {
  const shifted = new Date(day.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function storeMidnight(day: Date): string {
  const local = new TZDate(2000, 0, 1, REPORT_TIMEZONE);
  local.setFullYear(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return new Date(local.getTime()).toISOString();
}

export function getDefaultCalendarRange(now: Date): CalendarRange {
  const today = todayInStore(now);
  return {
    from: shiftCalendarDays(today, -29).toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
    timezone: REPORT_TIMEZONE,
  };
}

export function resolveCalendarRange(range: CalendarRange, now: Date): ResolvedRange {
  if (range.timezone !== REPORT_TIMEZONE) {
    throw new RangeError("Unsupported report timezone.");
  }

  const start = parseCalendarDate(range.from);
  const end = parseCalendarDate(range.to);
  const today = todayInStore(now);
  if (end < start || end > today) {
    throw new RangeError("Report dates must be ordered and cannot end in the future.");
  }

  // These UTC dates represent calendar labels, independently of the store's day lengths.
  const calendarDays = (end.getTime() - start.getTime()) / MILLISECONDS_PER_UTC_DAY + 1;
  const startInclusive = storeMidnight(start);
  return {
    ...range,
    startInclusive,
    endExclusive: storeMidnight(shiftCalendarDays(end, 1)),
    calendarDays,
    comparisonStartInclusive: storeMidnight(shiftCalendarDays(start, -calendarDays)),
    comparisonEndExclusive: startInclusive,
    partial: end.getTime() === today.getTime(),
  };
}
