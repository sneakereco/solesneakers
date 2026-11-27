import {
  REPORT_TIMEZONE,
  type MoneyValue,
  type ResolvedRange,
} from "../ReportContract/types";

export type ChartUnit = "usd" | "count" | "percent";
export type ChartValue = MoneyValue | number | null;
export const UNAVAILABLE = "Unavailable";

const integer = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const calendarLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const storeDateLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});
const storeTimeLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIMEZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatMoney(value: MoneyValue | null): string {
  if (value === null || value.cents === null) return UNAVAILABLE;
  const magnitude = BigInt(Math.abs(value.cents));
  return `${value.cents < 0 ? "-" : ""}$${integer.format(magnitude / 100n)}.${String(magnitude % 100n).padStart(2, "0")}`;
}

export function formatCount(value: number | null): string {
  return value === null ? UNAVAILABLE : integer.format(value);
}

export function formatPercent(value: number | null): string {
  return value === null ? UNAVAILABLE : percent.format(value);
}

export function moneyCoverage(value: MoneyValue | null): string | undefined {
  if (!value || value.complete) return undefined;
  return value.missingCount > 0
    ? `${formatCount(value.missingCount)} missing ${value.missingCount === 1 ? "value" : "values"}`
    : "Incomplete coverage";
}

export function chartNumber(value: ChartValue): number | null {
  return typeof value === "object" && value !== null ? value.cents : value;
}

export function formatChartValue(value: ChartValue, unit: ChartUnit): string {
  if (typeof value === "object" && value !== null) return formatMoney(value);
  if (value !== null && unit === "usd")
    return formatMoney({ cents: value, complete: true, missingCount: 0 });
  return unit === "percent" ? formatPercent(value) : formatCount(value);
}

export function formatCalendarRange(from: string, to: string): string {
  return calendarLabel.formatRange(
    new Date(`${from}T00:00:00Z`),
    new Date(`${to}T00:00:00Z`),
  );
}

export function formatStoreInterval(
  startInclusive: string,
  endExclusive: string,
): string {
  return storeDateLabel.formatRange(
    new Date(startInclusive),
    new Date(Date.parse(endExclusive) - 1),
  );
}

export function formatPreviousPeriod(range: ResolvedRange): string {
  return formatStoreInterval(
    range.comparisonStartInclusive,
    range.comparisonEndExclusive,
  );
}

export function formatStoreTime(value: string): string {
  return `${storeTimeLabel.format(new Date(value))} ET`;
}
