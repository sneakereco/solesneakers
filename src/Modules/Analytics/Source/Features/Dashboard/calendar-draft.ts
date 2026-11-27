import {
  getDefaultCalendarRange,
  resolveCalendarRange,
} from "../ReportContract/calendar-range";
import { REPORT_TIMEZONE, type CalendarRange } from "../ReportContract/types";

export type CalendarPreset = "7" | "30" | "90" | "month";

export function calendarPreset(preset: CalendarPreset, now: Date): CalendarRange {
  const range = getDefaultCalendarRange(now);
  if (preset === "30") return range;
  if (preset === "month") return { ...range, from: `${range.to.slice(0, 7)}-01` };
  const from = new Date(`${range.to}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - Number(preset) + 1);
  return { ...range, from: from.toISOString().slice(0, 10) };
}

export function readCalendarDraft(from: string, to: string, now: Date) {
  try {
    return resolveCalendarRange({ from, to, timezone: REPORT_TIMEZONE }, now);
  } catch {
    return null;
  }
}
