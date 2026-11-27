import scalars from "../CommerceFacts/fact-scalar-schemas.json";
import type { PrivateTrackingContext } from "../CommerceFacts/repository";

export type ConsentState =
  | { choice: "unknown" }
  | { choice: "declined"; pending?: true }
  | { choice: "accepted"; receiptId: string };
export type TrackingContext = PrivateTrackingContext;
export type Dimensions = NonNullable<TrackingContext["discovery"]>;
export type AcquisitionContext = Pick<
  TrackingContext,
  "discovery" | "purchaseSession"
> & {
  landing_pathname: string;
  referrer_host?: string;
};
export type BehaviorEvent =
  | { event: "public_page_viewed" | "storefront_viewed" | "checkout_started" }
  | { event: "product_viewed" | "out_of_stock_viewed"; product_id: string }
  | {
      event: "variant_selected" | "unavailable_size_requested";
      product_id: string;
      variant_id: string;
    }
  | {
      event: "catalog_search_results";
      result_count: number;
      concept_kind?: "brand" | "model" | "product";
      concept_id?: string;
    }
  | {
      event: "product_added_to_cart";
      product_id: string;
      variant_id: string;
      quantity: 1;
    };

const credentialUuid = /[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/i;
const uuid = new RegExp(scalars.id.pattern);
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.test(v);
export const isBuyerKey = (v: unknown): v is string =>
  typeof v === "string" && /^sole-buyer:v1:[0-9a-f]{64}$/.test(v);
export const isVisitorId = (v: unknown): v is string => isUuid(v) || isBuyerKey(v);
const publicPaths = new Set([
  "/",
  "/store",
  "/cart",
  "/checkout",
  "/hours",
  "/brands",
  "/contact",
  "/authenticity-guarantee",
  "/privacy",
  "/terms",
  "/refunds",
  "/shipping",
  "/legal/privacy",
  "/legal/terms",
  "/legal/shipping",
  "/legal/refunds",
]);
export function safePathname(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return publicPaths.has(v) || (v.startsWith("/store/") && isUuid(v.slice(7))) ? v : null;
}
export function safeSlug(v: unknown): string | null {
  if (
    typeof v !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(v) ||
    credentialUuid.test(v) ||
    /[a-z0-9]{24,}|token|secret|password|auth|session|key|(?:\d[ _-]?){7}/i.test(v)
  )
    return null;
  return v.toLowerCase();
}
export function safeReferrerHost(v: unknown): string | null {
  if (
    typeof v !== "string" ||
    v.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i.test(v)
  )
    return null;
  if (v.split(".").some((label) => !safeSlug(label))) return null;
  return v.toLowerCase();
}
export const dimensions = ["source", "channel", "campaign", "placement"] as const;
export function sanitizeMeasurementEvent(event: unknown, input: Record<string, unknown>) {
  const pathname = safePathname(input.pathname);
  if (
    !pathname ||
    input.storefront !== "sole" ||
    !["staging", "production"].includes(String(input.environment)) ||
    input.schema_version !== 2
  )
    return null;
  const props: Record<string, unknown> = {
    storefront: "sole",
    environment: input.environment,
    schema_version: 2,
    pathname,
    $geoip_disable: true,
  };
  switch (event) {
    case "public_page_viewed":
      break;
    case "storefront_viewed":
      if (pathname !== "/store") return null;
      break;
    case "checkout_started":
      if (pathname !== "/checkout") return null;
      break;
    case "catalog_search_results":
      if (
        typeof input.result_count !== "number" ||
        !Number.isSafeInteger(input.result_count) ||
        input.result_count < 0 ||
        input.result_count > 2147483647
      )
        return null;
      props.result_count = input.result_count;
      if (
        isUuid(input.concept_id) &&
        ["product", "brand", "model"].includes(String(input.concept_kind))
      ) {
        props.concept_kind = input.concept_kind;
        props.concept_id = input.concept_id;
      }
      break;
    case "variant_selected":
    case "unavailable_size_requested":
      if (
        !isUuid(input.variant_id) ||
        !isUuid(input.product_id) ||
        pathname !== "/store/" + input.product_id
      )
        return null;
      props.product_id = input.product_id;
      props.variant_id = input.variant_id;
      break;
    case "product_added_to_cart":
      if (!isUuid(input.variant_id) || input.quantity !== 1) return null;
      props.variant_id = input.variant_id;
      props.quantity = 1;
    // The same rendered product check applies to both product events.
    case "out_of_stock_viewed":
    case "product_viewed":
      if (!isUuid(input.product_id) || pathname !== "/store/" + input.product_id)
        return null;
      props.product_id = input.product_id;
      break;
    default:
      return null;
  }
  const landing = safePathname(input.landing_pathname);
  if (landing) props.landing_pathname = landing;
  const referrer = safeReferrerHost(input.referrer_host);
  if (referrer) props.referrer_host = referrer;
  if (["desktop", "mobile", "tablet", "unknown"].includes(String(input.device)))
    props.device = input.device;
  for (const prefix of ["discovery_", "session_"])
    for (const field of dimensions) {
      const key = prefix + field;
      const value = safeSlug(input[key]);
      if (value) props[key] = value;
    }
  return { event, properties: props };
}
