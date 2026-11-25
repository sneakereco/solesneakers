import "server-only";

import { z } from "zod";

import {
  requestPostHogJson,
  type PostHogFailure,
  type PostHogRequestDependencies,
} from "../Configuration/posthog-request";
import {
  isServerAnalyticsConfig,
  type ServerAnalyticsConfig,
} from "../Configuration/server-config";

const MAX_BATCH_SIZE = 50;
const CAPTURE_TIMEOUT_MS = 3_000;
const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const factProperties = z.strictObject({
  schema_version: z.literal(2),
  storefront: z.literal("sole"),
  environment: z.enum(["staging", "production"]),
  dataset_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  fact_id: z.string().regex(/^[a-z0-9][a-z0-9_:-]{0,127}$/),
  fact_revision: z.number().int().positive(),
  fact_kind: z.enum([
    "order",
    "line",
    "refund",
    "refund_line",
    "payment_attempt",
    "shipping_cost",
    "fee",
    "fulfillment",
    "inventory",
    "customer_summary",
  ]),
  effective_at: timestamp,
  recorded_at: timestamp,
  currency: z.literal("USD"),
  buyer_key: z
    .string()
    .regex(/^sole-buyer:v1:[a-f0-9]{64}$/)
    .nullable(),
  order_id: uuid.nullable(),
});

const publishedEvent = z.strictObject({
  uuid,
  event: z.literal("sole_analytics_fact_v2"),
  timestamp,
  distinctId: z
    .string()
    .refine(
      (value) =>
        value.startsWith("commerce:") &&
        uuid.safeParse(value.slice("commerce:".length)).success,
    ),
  properties: factProperties,
});

const acknowledgement = z.object({
  status: z.union([z.literal(1), z.literal("Ok")]),
  quota_limited: z.array(z.string()).optional(),
});

export type PublishedEvent = z.infer<typeof publishedEvent>;

export type CaptureDependencies = PostHogRequestDependencies & {
  config: ServerAnalyticsConfig | null;
};

export type CaptureResult =
  | { status: "accepted"; count: number }
  | PostHogFailure
  | { status: "permanent-failure"; reason: "invalid-events" };

export async function captureBatch(
  events: PublishedEvent[],
  deps: CaptureDependencies,
): Promise<CaptureResult> {
  const { config } = deps;
  if (!isServerAnalyticsConfig(config)) {
    return { status: "configuration-failure", reason: "not-configured" };
  }

  if (events.length > MAX_BATCH_SIZE) {
    return { status: "permanent-failure", reason: "invalid-events" };
  }
  const parsed = z.array(publishedEvent).safeParse(events);
  if (!parsed.success) {
    return { status: "permanent-failure", reason: "invalid-events" };
  }

  const ids = new Set<string>();
  for (const event of parsed.data) {
    const id = event.uuid.toLowerCase();
    if (
      ids.has(id) ||
      event.properties.environment !== config.environment ||
      event.timestamp !== event.properties.effective_at
    ) {
      return { status: "permanent-failure", reason: "invalid-events" };
    }
    ids.add(id);
  }

  if (!parsed.data.length) {
    return { status: "accepted", count: 0 };
  }

  const batch = parsed.data.map((event) => ({
    uuid: event.uuid,
    event: event.event,
    timestamp: event.timestamp,
    distinct_id: event.distinctId,
    properties: {
      ...event.properties,
      $geoip_disable: true,
      $process_person_profile: false,
    },
  }));

  const response = await requestPostHogJson(
    `${config.host}/batch/`,
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: config.projectKey, batch }),
    },
    deps,
    CAPTURE_TIMEOUT_MS,
  );
  if (response.status !== "ok") {
    return response;
  }

  const ack = acknowledgement.safeParse(response.data);
  if (!ack.success) {
    return { status: "retryable", reason: "invalid-response" };
  }
  if (ack.data.quota_limited?.length) {
    return { status: "retryable", reason: "rate-limited" };
  }
  return { status: "accepted", count: batch.length };
}
