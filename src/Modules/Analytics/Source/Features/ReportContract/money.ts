import type { MoneyValue } from "./types";

type CurrencyUnit = "dollars" | "cents";

export function toCents(value: number | string, unit: CurrencyUnit): number {
  const decimal = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match || match[0] !== decimal) {
    throw new RangeError("Money must be a decimal number.");
  }

  const [, sign, integer, fraction = ""] = match;
  const places = unit === "dollars" ? 2 : 0;
  if (/[1-9]/.test(fraction.slice(places))) {
    throw new RangeError("Fractional cents are unsupported.");
  }

  const cents = Number(integer + fraction.slice(0, places).padEnd(places, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Money exceeds the safe integer range.");
  }

  return sign === "-" && cents !== 0 ? -cents : cents;
}

export function toNonnegativeCents(value: number | string, unit: CurrencyUnit): number {
  const cents = toCents(value, unit);
  if (cents < 0) {
    throw new RangeError("Source amounts must be nonnegative.");
  }
  return cents;
}

export function toQuantity(value: number | string): number {
  const decimal = String(value);
  if (!/^\d/.test(decimal) || /\D/.test(decimal)) {
    throw new RangeError("Quantity must be a nonnegative integer.");
  }

  const quantity = Number(decimal);
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError("Quantity exceeds the safe integer range.");
  }
  return quantity;
}

export function moneyValue(cents: number | null, missingCount = 0): MoneyValue {
  if (cents !== null && !Number.isSafeInteger(cents)) {
    throw new RangeError("Money must use safe integer cents.");
  }
  if (!Number.isSafeInteger(missingCount) || missingCount < 0) {
    throw new RangeError("Missing money count must be a nonnegative safe integer.");
  }

  return { cents, complete: cents !== null && missingCount === 0, missingCount };
}
