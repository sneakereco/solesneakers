"use client";

import {
  sanitizeMeasurementEvent,
  type MeasurementEnvironment,
} from "@/lib/measurement/contract";

type MeasurementConfig = {
  projectKey: string;
  host: string;
  environment: MeasurementEnvironment;
};
type OutgoingEvent = { event: string; properties?: Record<string, unknown> };

const CLOUD_HOSTS = new Set(["https://us.i.posthog.com", "https://eu.i.posthog.com"]);

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

// This candidate has no verified current shopper-consent authority. Keep the
// existing component callbacks inert until that integration qualifies. Importing
// this module must not load the SDK, inspect browser identity or access storage.
export function initializeMeasurement(): void {}
export function captureStorefrontViewed(): void {}
export function captureProductViewed(_productId: string): void {}
export function captureProductAddedToCart(_productId: string, _variantId: string): void {}
export function captureCheckoutStarted(): void {}
