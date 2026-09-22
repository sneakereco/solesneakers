// Phase A intentionally accepts only these four behavioral events and a small,
// validated set of properties. This filter is also used as PostHog's before_send.
export const MEASUREMENT_SCHEMA_VERSION = 1;

export type MeasurementEventName =
  | "storefront_viewed"
  | "product_viewed"
  | "product_added_to_cart"
  | "checkout_started";

export type SafeAttribution = Partial<{
  landing_pathname: string;
  referrer_host: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
}>;

export type MeasurementProperties = SafeAttribution & {
  storefront: "sole";
  environment: "staging";
  schema_version: typeof MEASUREMENT_SCHEMA_VERSION;
  pathname: string;
  product_id?: string;
  variant_id?: string;
  quantity?: 1;
};

export type SanitizedMeasurementEvent = {
  event: MeasurementEventName;
  properties: MeasurementProperties;
};

const EVENT_NAMES: readonly MeasurementEventName[] = [
  "storefront_viewed",
  "product_viewed",
  "product_added_to_cart",
  "checkout_started",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export function safePathname(value: unknown): string | null {
  if (value === "/" || value === "/store" || value === "/cart" || value === "/checkout") {
    return value;
  }
  if (typeof value === "string" && /^\/store\/[0-9a-f-]{36}$/i.test(value)) {
    return UUID.test(value.slice(7)) ? value.toLowerCase() : null;
  }
  return null;
}

function safeSlug(value: unknown): string | null {
  if (typeof value !== "string" || !SAFE_SLUG.test(value)) {
    return null;
  }
  // Reject token-like high-entropy strings and obvious credential labels.
  if (
    /[a-z0-9]{24,}/i.test(value) ||
    /(?:token|secret|password|auth|session|key)/i.test(value)
  ) {
    return null;
  }
  return value.toLowerCase();
}

function safeReferrerHost(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 253) {
    return null;
  }
  const host = value.toLowerCase();
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    ? host
    : null;
}

export function extractSafeAttribution(url: string, referrer: string): SafeAttribution {
  try {
    const current = new URL(url);
    if (current.protocol !== "https:" && current.protocol !== "http:") {
      return {};
    }
    const safe: SafeAttribution = {};
    const landing = safePathname(current.pathname);
    if (landing) {
      safe.landing_pathname = landing;
    }
    for (const key of ATTRIBUTION_KEYS) {
      const values = current.searchParams.getAll(key);
      if (values.length !== 1) {
        continue;
      }
      const value = safeSlug(values[0]);
      if (value) {
        safe[key] = value;
      }
    }
    if (referrer) {
      try {
        const previous = new URL(referrer);
        if (previous.protocol === "https:" || previous.protocol === "http:") {
          const host = safeReferrerHost(previous.hostname);
          if (host && host !== current.hostname.toLowerCase()) {
            safe.referrer_host = host;
          }
        }
      } catch {
        // A malformed referrer does not invalidate safe landing/UTM fields.
      }
    }
    return safe;
  } catch {
    return {};
  }
}

export function sanitizeMeasurementEvent(
  event: unknown,
  properties: unknown,
): SanitizedMeasurementEvent | null {
  if (typeof event !== "string" || !EVENT_NAMES.includes(event as MeasurementEventName)) {
    return null;
  }
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return null;
  }
  const input = properties as Record<string, unknown>;
  if (
    input.storefront !== "sole" ||
    input.environment !== "staging" ||
    input.schema_version !== MEASUREMENT_SCHEMA_VERSION
  ) {
    return null;
  }
  const pathname = safePathname(input.pathname);
  if (!pathname) {
    return null;
  }
  const name = event as MeasurementEventName;
  if (name === "storefront_viewed" && pathname !== "/store") {
    return null;
  }
  if (name === "product_viewed" && !pathname.startsWith("/store/")) {
    return null;
  }
  if (name === "product_added_to_cart" && !pathname.startsWith("/store/")) {
    return null;
  }
  if (name === "checkout_started" && pathname !== "/checkout") {
    return null;
  }

  const output: MeasurementProperties = {
    storefront: "sole",
    environment: "staging",
    schema_version: MEASUREMENT_SCHEMA_VERSION,
    pathname,
  };
  const landing = safePathname(input.landing_pathname);
  if (landing) {
    output.landing_pathname = landing;
  }
  const host = safeReferrerHost(input.referrer_host);
  if (host) {
    output.referrer_host = host;
  }
  for (const key of ATTRIBUTION_KEYS) {
    const value = safeSlug(input[key]);
    if (value) {
      output[key] = value;
    }
  }
  if (name === "product_viewed" || name === "product_added_to_cart") {
    if (typeof input.product_id !== "string" || !UUID.test(input.product_id)) {
      return null;
    }
    if (pathname !== `/store/${input.product_id.toLowerCase()}`) {
      return null;
    }
    output.product_id = input.product_id.toLowerCase();
  }
  if (name === "product_added_to_cart") {
    if (
      typeof input.variant_id !== "string" ||
      !UUID.test(input.variant_id) ||
      input.quantity !== 1
    ) {
      return null;
    }
    output.variant_id = input.variant_id.toLowerCase();
    output.quantity = 1;
  }
  return { event: name, properties: output };
}
