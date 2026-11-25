import "server-only";

import { z } from "zod";
import { factFields, factPayloadSchemas, type FactKind } from "../CommerceFacts/contract";

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
const timestamp = factFields.effectiveAt;

function wireVariant<K extends FactKind>(kind: K) {
  return z.strictObject({
    schema_version: z.literal(2),
    storefront: z.literal("sole"),
    environment: z.enum(["staging", "production"]),
    dataset_id: factFields.datasetId,
    fact_id: factFields.factId,
    fact_revision: factFields.revision,
    fact_kind: z.literal(kind),
    effective_at: factFields.effectiveAt,
    recorded_at: factFields.recordedAt,
    currency: factFields.currency,
    buyer_key: factFields.buyerKey,
    order_id: factFields.orderId,
    payload: factPayloadSchemas[kind],
  });
}

const factProperties = z.discriminatedUnion("fact_kind", [
  wireVariant("order"),
  wireVariant("line"),
  wireVariant("refund"),
  wireVariant("refund_line"),
  wireVariant("payment_attempt"),
  wireVariant("shipping_cost"),
  wireVariant("fee"),
  wireVariant("fulfillment"),
  wireVariant("inventory"),
  wireVariant("customer_summary"),
]);

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
