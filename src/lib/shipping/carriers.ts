export const CARRIER_KEYS = ["UPS", "USPS", "FEDEX"] as const;

export type CarrierKey = (typeof CARRIER_KEYS)[number];

export function normalizeCarrier(value: unknown): CarrierKey | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return CARRIER_KEYS.find((carrier) => carrier === normalized) ?? null;
}

export function parseCarrierSelection(values: unknown): CarrierKey[] {
  if (!Array.isArray(values)) {
    throw new Error("shipping_carrier_invalid");
  }

  const normalized = values.map(normalizeCarrier);
  if (normalized.some((carrier) => carrier === null)) {
    throw new Error("shipping_carrier_invalid");
  }

  const selected = new Set(normalized as CarrierKey[]);
  return CARRIER_KEYS.filter((carrier) => selected.has(carrier));
}

export function parseStoredCarrierSelection(values: unknown): CarrierKey[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const selected = new Set(
    values
      .map(normalizeCarrier)
      .filter((carrier): carrier is CarrierKey => carrier !== null),
  );
  return CARRIER_KEYS.filter((carrier) => selected.has(carrier));
}

export function toggleCarrierSelection(
  enabled: CarrierKey[],
  carrier: CarrierKey,
): CarrierKey[] {
  const selected = new Set(enabled);
  if (selected.has(carrier)) {
    selected.delete(carrier);
  } else {
    selected.add(carrier);
  }
  return CARRIER_KEYS.filter((candidate) => selected.has(candidate));
}
