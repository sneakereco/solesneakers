"use client";
import posthog, { type CaptureResult, type PostHog } from "posthog-js";
import type { PublicAnalyticsConfig } from "../Configuration/public-config";
import { configuredMeasurement, isApprovedMeasurementHostname } from "./host-gate";
import { acquisitionForSession, clearAcquisition } from "./attribution";
import { withdrawalPending } from "./preference-marker";
import {
  isUuid,
  isBuyerKey,
  isVisitorId,
  safePathname,
  sanitizeMeasurementEvent,
  type BehaviorEvent,
  type ConsentState,
  type TrackingContext,
  type AcquisitionContext,
} from "./contract";

let active: {
  sdk: PostHog;
  config: PublicAnalyticsConfig;
  receiptId: string;
  abort: AbortController;
} | null = null;
let instances = 0;
let account: string | null = null;
let suspended = false;
let identityReady = true;
let authorizedBuyer: string | null = null;
let generation = 0;

function eligible(config: PublicAnalyticsConfig) {
  return (
    typeof window !== "undefined" &&
    isApprovedMeasurementHostname(window.location.hostname, config.environment) &&
    safePathname(window.location.pathname) !== null &&
    !suspended &&
    !withdrawalPending()
  );
}
function ready() {
  if (!active || !identityReady || !eligible(active.config)) return null;
  try {
    const id = active.sdk.get_distinct_id();
    return account
      ? id === authorizedBuyer
        ? active
        : null
      : isUuid(id)
        ? active
        : null;
  } catch {
    return null;
  }
}

export function filterOutgoingEvent(
  event: CaptureResult,
  config: PublicAnalyticsConfig,
): CaptureResult | null {
  const p = event.properties;
  if (
    p.token !== config.projectKey ||
    !isVisitorId(p.distinct_id) ||
    !isUuid(p.$session_id)
  )
    return null;
  const ids = {
    token: config.projectKey,
    distinct_id: p.distinct_id,
    $session_id: p.$session_id,
  };
  let properties: Record<string, unknown>;
  if (event.event === "$identify") {
    if (!isBuyerKey(p.distinct_id) || !isUuid(p.$anon_distinct_id)) return null;
    properties = {
      ...ids,
      $anon_distinct_id: p.$anon_distinct_id,
      $geoip_disable: true,
      $process_person_profile: true,
    };
  } else {
    const safe = sanitizeMeasurementEvent(event.event, p);
    if (!safe || safe.properties.environment !== config.environment) return null;
    properties = {
      ...safe.properties,
      ...ids,
      $process_person_profile: isBuyerKey(p.distinct_id),
    };
  }
  // Profile fields can also arrive on the event envelope itself.
  return { uuid: event.uuid, event: event.event, timestamp: event.timestamp, properties };
}

export function initializeMeasurement(
  config: PublicAnalyticsConfig,
  consent: ConsentState,
): void {
  if (consent.choice !== "accepted") {
    if (active) revokeMeasurement();
    return;
  }
  const compiled = configuredMeasurement();
  if (
    !compiled ||
    compiled.environment !== config.environment ||
    compiled.projectKey !== config.projectKey ||
    compiled.host !== config.host ||
    !isUuid(consent.receiptId) ||
    !eligible(config)
  )
    return;
  if (active?.receiptId === consent.receiptId) return;
  if (active) revokeMeasurement();
  const abort = new AbortController();
  // Keep retries from a withdrawn grant off the wire, including pagehide transport.
  const fetchOptions = {
    cache: "no-store" as const,
    signal: abort.signal,
    referrerPolicy: "no-referrer" as const,
  };
  try {
    const sdk = posthog.init(
      config.projectKey,
      {
        api_host: config.host,
        api_transport: "fetch",
        disable_beacon: true,
        fetch_options: fetchOptions,
        request_batching: false,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_performance: false,
        rageclick: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_web_experiments: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_external_dependency_loading: true,
        advanced_disable_flags: true,
        save_referrer: false,
        save_campaign_params: false,
        disable_capture_url_hashes: true,
        ip: false,
        // SDK session-entry and search fields are scrubbed in the same turn, before its native storage flush.
        persistence_save_debounce_ms: 1,
        person_profiles: "identified_only",
        persistence: "localStorage",
        cross_subdomain_cookie: false,
        opt_out_persistence_by_default: true,
        mask_all_element_attributes: true,
        mask_all_text: true,
        before_send: (event) => {
          if (!event || active?.abort !== abort) return null;
          // The SDK collects search keywords independently of its campaign/referrer flags.
          active.sdk.unregister_for_session("ph_keyword");
          active.sdk.unregister_for_session("$search_engine");
          if (!eligible(config) || (!identityReady && event.event !== "$identify"))
            return null;
          if (
            isBuyerKey(event.properties.distinct_id) &&
            event.properties.distinct_id !== authorizedBuyer
          )
            return null;
          return filterOutgoingEvent(event, config);
        },
      },
      instances++ === 0 ? undefined : "sole_grant_" + instances,
    );
    if (!sdk) return;
    active = { sdk, config, receiptId: consent.receiptId, abort };
    if (sdk.has_opted_out_capturing?.())
      sdk.opt_in_capturing({ captureEventName: false });
    // The native session manager otherwise keeps its raw entry URL and referrer.
    sdk.onSessionId(() => sdk.unregister("$client_session_props"));
    if (!account && isBuyerKey(sdk.get_distinct_id())) resetIdentity();
    identityReady = !account;
  } catch {
    abort.abort();
    active = null;
  }
}
function resetIdentity() {
  clearAcquisition();
  active?.sdk.reset(true);
}
export function setMeasurementAccount(next: string | null, blocked: boolean): void {
  if (account === next && suspended === blocked) return;
  ++generation;
  authorizedBuyer = null;
  const changed = account !== null && account !== next;
  suspended = blocked;
  account = next;
  identityReady = !next && !blocked;
  if (changed) resetIdentity();
}
export function suspendMeasurementAccount(): void {
  setMeasurementAccount(account, true);
}

export async function verifyMeasurementIdentity(): Promise<
  "ready" | "unavailable" | "denied"
> {
  if (!active || !eligible(active.config)) return "denied";
  if (!account) return "ready";
  const stamp = ++generation;
  const { sdk } = active;
  identityReady = false;
  try {
    const response = await fetch("/api/analytics/identity", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(5000),
    });
    const buyerKey = response.ok ? (await response.json())?.buyerKey : null;
    if (stamp !== generation || !active || !eligible(active.config)) return "denied";
    if (!response.ok && response.status !== 403) return "unavailable";
    const prior = sdk.get_distinct_id();
    if (isBuyerKey(prior) && prior !== buyerKey) resetIdentity();
    if (isBuyerKey(buyerKey)) {
      authorizedBuyer = buyerKey;
      sdk.identify(buyerKey);
      identityReady = true;
      return "ready";
    }
    return "denied";
  } catch {
    return stamp === generation ? "unavailable" : "denied";
  }
}
export async function identifyConsentingCustomer(): Promise<void> {
  await verifyMeasurementIdentity();
}
export function revokeMeasurement(): void {
  ++generation;
  const prior = active;
  active = null;
  identityReady = false;
  authorizedBuyer = null;
  prior?.abort.abort();
  if (typeof window === "undefined") return;
  clearAcquisition();
  if (prior) {
    try {
      prior.sdk.set_config({ disable_persistence: true });
      prior.sdk.opt_out_capturing();
      void prior.sdk.shutdown?.();
    } catch {
      // The grant and transport have already been disabled. Continue local cleanup.
    }
  }
  const token = prior?.config.projectKey ?? configuredMeasurement()?.projectKey;
  if (!token) return;
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of [
        "ph_" + token + "_posthog",
        "ph_" + token + "_window_id",
        "ph_" + token + "_primary_window_exists",
        "__ph_opt_in_out_" + token,
      ])
        storage.removeItem(key);
    }
  } catch {
    /* Blocked storage carries no usable optional identity. */
  }
}
export function readAcquisition(): AcquisitionContext | null {
  const state = ready();
  return state ? acquisitionForSession(state.sdk.get_session_id()) : null;
}
function device(): TrackingContext["device"] {
  if (typeof navigator === "undefined" || !navigator.userAgent) return "unknown";
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(navigator.userAgent)) return "tablet";
  return /Mobile|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop";
}
export function getCheckoutTrackingContext(): TrackingContext | null {
  const state = ready();
  if (!state) return null;
  try {
    const visitorId = state.sdk.get_distinct_id();
    const sessionId = state.sdk.get_session_id();
    if (!isVisitorId(visitorId) || !isUuid(sessionId)) return null;
    const acq = acquisitionForSession(sessionId);
    return {
      receiptId: state.receiptId,
      visitorId,
      sessionId,
      device: device(),
      discovery: acq?.discovery ?? null,
      purchaseSession: acq?.purchaseSession ?? null,
    };
  } catch {
    return null;
  }
}
export function capture(event: BehaviorEvent): void {
  const state = ready();
  if (!state) return;
  try {
    const acq = readAcquisition();
    const properties: Record<string, unknown> = {
      ...event,
      storefront: "sole",
      schema_version: 2,
      environment: state.config.environment,
      pathname: window.location.pathname,
      device: device(),
      landing_pathname: acq?.landing_pathname,
      referrer_host: acq?.referrer_host,
    };
    for (const [prefix, values] of [
      ["discovery_", acq?.discovery],
      ["session_", acq?.purchaseSession],
    ] as const) {
      for (const [key, value] of Object.entries(values ?? {}))
        properties[prefix + key] = value;
    }
    const safe = sanitizeMeasurementEvent(event.event, properties);
    if (safe) state.sdk.capture(event.event, safe.properties);
  } catch {
    /* Measurement cannot interrupt shopping or checkout. */
  }
}
