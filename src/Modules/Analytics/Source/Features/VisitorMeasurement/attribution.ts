import {
  dimensions,
  isUuid,
  safePathname,
  safeReferrerHost,
  safeSlug,
  type AcquisitionContext,
  type Dimensions,
} from "./contract";

// Only consented calls enter this module. Native session rotation selects a new landing.
const DISCOVERY = "sole_analytics_discovery_v2";
const SESSION = "sole_analytics_acquisition_v2";
let current: { id: string; context: AcquisitionContext } | null = null;

function cleanDimensions(input: unknown): Dimensions | null {
  if (!input || typeof input !== "object") return null;
  const result: Dimensions = {};
  for (const field of dimensions) {
    const value = safeSlug((input as Dimensions)[field]);
    if (value) result[field] = value;
  }
  return Object.keys(result).length ? result : null;
}
function stored(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* In-memory capture is still available. */
  }
}
export function clearAcquisition() {
  current = null;
  try {
    for (const key of [DISCOVERY, SESSION]) window.localStorage.removeItem(key);
    window.sessionStorage.removeItem("sole_phase_a_attribution_v1");
  } catch {
    /* Storage may be unavailable. */
  }
}
export function acquisitionForSession(id: string): AcquisitionContext | null {
  const landing = safePathname(window.location.pathname);
  if (!isUuid(id) || !landing) return null;
  if (current?.id === id) return current.context;
  const previous = stored(SESSION) as {
    id?: string;
    context?: Partial<AcquisitionContext>;
  } | null;
  const saved = previous?.id === id ? previous.context : null;
  const savedLanding = safePathname(saved?.landing_pathname);
  let context: AcquisitionContext;
  let discovery =
    cleanDimensions(stored(DISCOVERY)) ?? current?.context.discovery ?? null;
  if (saved && savedLanding) {
    const host = safeReferrerHost(saved.referrer_host);
    context = {
      discovery,
      purchaseSession: cleanDimensions(saved.purchaseSession),
      landing_pathname: savedLanding,
      ...(host ? { referrer_host: host } : {}),
    };
  } else {
    const url = new URL(window.location.href);
    const tags = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];
    const observed: Dimensions = {};
    for (const [index, field] of dimensions.entries()) {
      const values = url.searchParams.getAll(tags[index]);
      const clean = values.length === 1 ? safeSlug(values[0]) : null;
      if (clean) observed[field] = clean;
    }
    let referrer: string | null = null;
    try {
      const from = new URL(document.referrer);
      if (["http:", "https:"].includes(from.protocol) && from.hostname !== url.hostname)
        referrer = safeReferrerHost(from.hostname);
    } catch {
      /* No usable external referrer. */
    }
    if (!observed.source && referrer)
      observed.source = safeSlug(referrer.replaceAll(".", "-")) ?? "referral";
    const purchaseSession = cleanDimensions(observed) ?? { source: "direct-unknown" };
    if (
      !discovery ||
      (discovery.source === "direct-unknown" &&
        purchaseSession.source !== "direct-unknown")
    ) {
      discovery = purchaseSession;
      write(DISCOVERY, discovery);
    }
    context = {
      discovery,
      purchaseSession,
      landing_pathname: landing,
      ...(referrer ? { referrer_host: referrer } : {}),
    };
  }
  current = { id, context };
  write(SESSION, current);
  return context;
}
