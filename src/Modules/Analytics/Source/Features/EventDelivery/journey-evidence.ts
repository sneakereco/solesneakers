import "server-only";
import { z } from "zod";
import type { DatasetScope } from "../CommerceFacts/contract";
import { endpoint } from "../Reporting/queries/commerce-source";
import { compileBehaviorHistorySql } from "./behavior-archive";

export function journeyEndpoint(scope: DatasetScope) {
  return endpoint(
    "sole_analytics_journey",
    `SELECT event_name,toString(event_uuid) AS event_uuid
    FROM (${compileBehaviorHistorySql(scope)}) WHERE session_id={variables.session_id}
    ORDER BY occurred_at,event_uuid LIMIT 101`,
  );
}
const instant = z.iso.datetime({ offset: true });
export const journeyEvidence = z.strictObject({
  sessionId: z.uuid(),
  orderId: z.uuid(),
  refundId: z.uuid(),
  browserClosedAt: instant,
  start: instant,
  end: instant,
  // IDs of the successful interactions recorded by the consenting test browser.
  events: z
    .array(
      z.strictObject({
        name: z.enum([
          "public_page_viewed",
          "storefront_viewed",
          "product_viewed",
          "product_added_to_cart",
          "checkout_started",
          "catalog_search_results",
          "out_of_stock_viewed",
          "variant_selected",
          "unavailable_size_requested",
        ]),
        id: z.uuid(),
      }),
    )
    .min(3)
    .max(100),
});
export function verifyJourney(input: unknown, provider: unknown, source: unknown) {
  const j = journeyEvidence.parse(input);
  const page = z
    .object({
      columns: z.tuple([z.literal("event_name"), z.literal("event_uuid")]),
      hasMore: z.literal(false),
      results: z.array(z.tuple([z.string(), z.uuid()])).max(100),
    })
    .parse(provider);
  const observed = new Set(page.results.map(([name, id]) => name + "/" + id));
  if (
    observed.size !== j.events.length ||
    observed.size !== page.results.length ||
    !["product_viewed", "product_added_to_cart", "checkout_started"].every((name) =>
      j.events.some((e) => e.name === name),
    ) ||
    !j.events.every((e) => observed.delete(e.name + "/" + e.id))
  )
    throw Error("Journey event mismatch");
  const snapshot = z
    .object({
      revisions: z.number().int(),
      publications: z.array(
        z.object({
          publicationId: z.uuid(),
          fact: z.object({
            kind: z.string(),
            revision: z.number().int().positive(),
            factId: z.string(),
            orderId: z.string().nullable(),
            recordedAt: instant,
            payload: z.record(z.string(), z.unknown()),
          }),
        }),
      ),
    })
    .parse(source);
  if (snapshot.revisions !== snapshot.publications.length)
    throw Error("Incomplete journey source");
  const facts = snapshot.publications
    .map((p) => p.fact)
    .filter((f) => f.orderId === j.orderId);
  if (
    !facts.some(
      (f) =>
        f.kind === "order" &&
        f.revision === 1 &&
        Date.parse(f.recordedAt) >= Date.parse(j.browserClosedAt),
    ) ||
    !facts.some((f) => f.kind === "refund" && f.payload.refundId === j.refundId)
  )
    throw Error("Journey order/refund unavailable");
}
