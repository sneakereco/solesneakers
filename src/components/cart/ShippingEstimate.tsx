"use client";

import { useEffect, useState } from "react";
import { Truck } from "lucide-react";

const SHIPPING_TIME_ZONE = "America/New_York";
const SHIPPING_CUTOFF_HOUR = 15;

type ShippingEstimateData = {
  dateLabel: string;
  shipsSameDay: boolean;
  supportingText: string;
};

const getOrdinalSuffix = (day: number) => {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) {
    return "th";
  }

  if (day % 10 === 1) {
    return "st";
  }
  if (day % 10 === 2) {
    return "nd";
  }
  if (day % 10 === 3) {
    return "rd";
  }
  return "th";
};

const getPart = (parts: Intl.DateTimeFormatPart[], type: string) =>
  Number(parts.find((part) => part.type === type)?.value ?? 0);

export const getShippingEstimate = (now: Date): ShippingEstimateData => {
  const easternParts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHIPPING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);

  const year = getPart(easternParts, "year");
  const month = getPart(easternParts, "month");
  const day = getPart(easternParts, "day");
  const hour = getPart(easternParts, "hour");
  const minute = getPart(easternParts, "minute");
  const shipsSameDay = hour < SHIPPING_CUTOFF_HOUR;
  const shippingDate = new Date(Date.UTC(year, month - 1, day + (shipsSameDay ? 0 : 1)));
  const shippingDateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).formatToParts(shippingDate);
  const weekday = shippingDateParts.find((part) => part.type === "weekday")?.value;
  const monthLabel = shippingDateParts.find((part) => part.type === "month")?.value;
  const shippingDay = getPart(shippingDateParts, "day");
  const dateLabel = `${weekday}, ${monthLabel} ${shippingDay}${getOrdinalSuffix(shippingDay)}`;

  if (!shipsSameDay) {
    return {
      dateLabel,
      shipsSameDay,
      supportingText: "Orders placed now ship the following day.",
    };
  }

  const remainingMinutes = SHIPPING_CUTOFF_HOUR * 60 - (hour * 60 + minute);
  const remainingHours = Math.floor(remainingMinutes / 60);
  const minutesAfterHours = remainingMinutes % 60;
  const timeRemaining =
    remainingHours > 0
      ? `${remainingHours} hr${remainingHours === 1 ? "" : "s"} ${minutesAfterHours} min`
      : `${minutesAfterHours} min`;

  return {
    dateLabel,
    shipsSameDay,
    supportingText: `Order within ${timeRemaining} for same-day shipping.`,
  };
};

export function ShippingEstimate({ className = "" }: { className?: string }) {
  const [estimate, setEstimate] = useState<ShippingEstimateData | null>(null);

  useEffect(() => {
    const updateEstimate = () => setEstimate(getShippingEstimate(new Date()));

    updateEstimate();
    const intervalId = window.setInterval(updateEstimate, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <section
      data-shipping-estimate
      className={`flex min-h-[4.5rem] items-center gap-3 bg-zinc-50 px-5 py-4 ${className}`.trim()}
      aria-live="polite"
    >
      <Truck className="h-5 w-5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
      {estimate ? (
        <div>
          <p className="text-sm font-medium">Order ships by {estimate.dateLabel}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{estimate.supportingText}</p>
        </div>
      ) : (
        <div className="w-full" aria-label="Calculating shipping date">
          <div className="h-4 w-44 animate-pulse bg-zinc-200" />
          <div className="mt-2 h-3 w-56 animate-pulse bg-zinc-200" />
        </div>
      )}
    </section>
  );
}
