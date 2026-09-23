"use client";

import posthog from "posthog-js";

import {
  extractSafeAttribution,
  MEASUREMENT_SCHEMA_VERSION,
  safePathname,
  sanitizeMeasurementEvent,
  type MeasurementEnvironment,
  type MeasurementEventName,
  type SafeAttribution,
} from "@/lib/measurement/contract";
import { isApprovedMeasurementHostname } from "@/lib/measurement/host-gate";

type MeasurementConfig = {
  projectKey: string;
  host: string;
  environment: MeasurementEnvironment;
};
type OutgoingEvent = { event: string; properties?: Record<string, unknown> };

const ATTRIBUTION_STORAGE_KEY = "sole_phase_a_attribution_v1";
const CLOUD_HOSTS = new Set(["https://us.i.posthog.com", "https://eu.i.posthog.com"]);
let initialized = false;
let attribution: SafeAttribution | null = null;

export function resolveMeasurementConfig(input: {
  enabled?: string;
  environment?: string;
  projectKey?: string;
  host?: string;
}): MeasurementConfig | null {
  if (
    input.enabled !== "true" ||
    (input.environment !== "staging" && input.environment !== "production")
  ) {
    return null;
  }
  const projectKey = input.projectKey?.trim() ?? "";
  const host = input.host?.trim() ?? "";
  if (!/^phc_[a-z0-9]{20,}$/i.test(projectKey) || !CLOUD_HOSTS.has(host)) {
    return null;
  }
  return { projectKey, host, environment: input.environment };
}

function configuredMeasurement(): MeasurementConfig | null {
  return resolveMeasurementConfig({
    enabled: process.env.NEXT_PUBLIC_POSTHOG_ENABLED,
    environment: process.env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT,
    projectKey: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}

const SDK_CORRELATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function filterOutgoingEvent<T extends OutgoingEvent>(
  event: T,
  expectedProjectKey: string,
  expectedEnvironment: MeasurementEnvironment,
): T | null {
  const safe = sanitizeMeasurementEvent(event.event, event.properties);
  if (
    !safe ||
    safe.properties.environment !== expectedEnvironment ||
    !/^phc_[a-z0-9]{20,}$/i.test(expectedProjectKey)
  ) {
    return null;
  }
  const input = event.properties ?? {};
  if (input.token !== expectedProjectKey) {
    return null;
  }
  const distinctId = input.distinct_id;
  const sessionId = input.$session_id;
  if (
    typeof distinctId !== "string" ||
    !SDK_CORRELATION_ID.test(distinctId) ||
    typeof sessionId !== "string" ||
    !SDK_CORRELATION_ID.test(sessionId)
  ) {
    return null;
  }
  return {
    ...event,
    properties: {
      ...safe.properties,
      token: expectedProjectKey,
      distinct_id: distinctId.toLowerCase(),
      $session_id: sessionId.toLowerCase(),
    },
  };
}

function getAttribution(): SafeAttribution {
  if (attribution) {
    return attribution;
  }
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const stored = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Stored data is untrusted; the final event filter validates it again.
        attribution = parsed as SafeAttribution;
        return attribution;
      }
    }
  } catch {
    // Storage can be blocked; current-page attribution is still safe to use.
  }
  attribution = extractSafeAttribution(window.location.href, document.referrer);
  try {
    window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Measurement must not affect browsing when storage is unavailable.
  }
  return attribution;
}

export function initializeMeasurement(): void {
  if (initialized || typeof window === "undefined") {
    return;
  }
  const config = configuredMeasurement();
  if (
    !config ||
    !isApprovedMeasurementHostname(window.location.hostname, config.environment)
  ) {
    return;
  }
  try {
    getAttribution();
    posthog.init(config.projectKey, {
      api_host: config.host,
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
      advanced_disable_flags: true,
      save_referrer: false,
      save_campaign_params: false,
      disable_capture_url_hashes: true,
      person_profiles: "never",
      persistence: "sessionStorage",
      cross_subdomain_cookie: false,
      before_send: (event) =>
        event ? filterOutgoingEvent(event, config.projectKey, config.environment) : null,
    });
    initialized = true;
  } catch {
    // SDK initialization must never block storefront or checkout behavior.
  }
}

function capture(event: MeasurementEventName, properties: Record<string, unknown>): void {
  if (!initialized || typeof window === "undefined") {
    return;
  }
  const config = configuredMeasurement();
  if (
    !config ||
    !isApprovedMeasurementHostname(window.location.hostname, config.environment)
  ) {
    return;
  }
  const pathname = safePathname(window.location.pathname);
  if (!pathname) {
    return;
  }
  const safe = sanitizeMeasurementEvent(event, {
    ...getAttribution(),
    ...properties,
    storefront: "sole",
    environment: config.environment,
    schema_version: MEASUREMENT_SCHEMA_VERSION,
    pathname,
  });
  if (!safe) {
    return;
  }
  try {
    posthog.capture(safe.event, safe.properties);
  } catch {
    // Analytics failure is deliberately invisible to the customer flow.
  }
}

export function captureStorefrontViewed(): void {
  capture("storefront_viewed", {});
}

export function captureProductViewed(productId: string): void {
  capture("product_viewed", { product_id: productId });
}

export function captureProductAddedToCart(productId: string, variantId: string): void {
  capture("product_added_to_cart", {
    product_id: productId,
    variant_id: variantId,
    quantity: 1,
  });
}

export function captureCheckoutStarted(): void {
  capture("checkout_started", {});
}
