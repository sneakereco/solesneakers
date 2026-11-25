import { z } from "zod";
import { REPORT_FILTER_VALUES } from "../ReportContract/types";

const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const money = z.number().int().nonnegative();
const count = money;
const positive = count.positive();
const label = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} .,'’&+()\/#:!"_\-]*$/u)
  .refine(
    (value) =>
      !/[0-9](?:[ .()-]*[0-9]){8}|(?:[0-9]{1,3}\.){3}[0-9]{1,3}|(?:[0-9A-Fa-f]{0,4}:){2,}|https?:\/\//i.test(
        value,
      ),
    "Invalid catalog label",
  );
const method = z.enum(REPORT_FILTER_VALUES.paymentMethod);
const orderStatus = z.enum(REPORT_FILTER_VALUES.status);
const methodOfFulfillment = z.enum(REPORT_FILTER_VALUES.fulfillment);
const refundStatus = z.enum(["pending", "failed", "canceled", "completed"]);
const stage = z.enum(["checkout", "reservation", "payment", "verification"]);
const outcome = z.enum([
  "pending",
  "unknown",
  "succeeded",
  "failed",
  "canceled",
  "expired",
]);
const reason = z.enum([
  "none",
  "unknown",
  "declined",
  "timeout",
  "unavailable",
  "invalid",
  "inventory",
  "expired",
  "canceled",
  "verification",
  "blocked",
]);
const adjustment = z.enum(["charge", "credit"]);
const fulfillmentState = z.enum([
  "pending",
  "processing",
  "unfulfilled",
  "ready",
  "ready_for_pickup",
  "shipped",
  "delivered",
  "picked_up",
  "fulfilled",
  "canceled",
  "unknown",
]);
export const factPayloadSchemas = {
  order: z.strictObject({
    grossMerchandiseCents: money.nullable(),
    discountCents: money.nullable(),
    merchandiseCents: money.nullable(),
    shippingCents: money.nullable(),
    taxCents: money.nullable(),
    totalCollectedCents: money,
    paymentMethod: method.nullable(),
    fulfillment: methodOfFulfillment.nullable(),
    status: orderStatus,
  }),
  line: z.strictObject({
    lineId: id,
    productId: id,
    variantId: id.nullable(),
    productName: label,
    brandId: id.nullable(),
    brandLabel: label.nullable(),
    categoryId: id.nullable(),
    categoryLabel: label.nullable(),
    sizeId: id.nullable(),
    sizeLabel: label.nullable(),
    quantity: positive,
    unitGrossCents: money.nullable(),
    discountCents: money.nullable(),
    merchandiseCents: money.nullable(),
    unitCostCents: money.nullable(),
  }),
  refund: z.strictObject({
    refundId: id,
    status: refundStatus,
    totalCents: money,
    merchandiseCents: money.nullable(),
    shippingCents: money.nullable(),
    taxCents: money.nullable(),
    unallocatedCents: money,
  }),
  refund_line: z.strictObject({
    refundId: id,
    lineId: id,
    merchandiseCents: money.nullable(),
    quantity: count.nullable(),
    restockedQuantity: count.nullable(),
  }),
  payment_attempt: z.strictObject({
    attemptId: id,
    stage: stage,
    outcome: outcome,
    method: method.nullable(),
    reason: reason,
    resolvedAt: timestamp.nullable(),
  }),
  shipping_cost: z.strictObject({
    adjustment: adjustment,
    amountCents: money,
  }),
  fee: z.strictObject({
    adjustment: adjustment,
    amountCents: money,
  }),
  fulfillment: z.strictObject({
    method: methodOfFulfillment,
    state: fulfillmentState,
    paidAt: timestamp.nullable(),
    fulfilledAt: timestamp.nullable(),
  }),
  inventory: z.strictObject({
    productId: id,
    variantId: id.nullable(),
    availableUnits: count.nullable(),
  }),
  customer_summary: z.strictObject({
    firstPurchaseAt: timestamp,
    lastPurchaseAt: timestamp,
    confirmedOrders: positive,
    observedSpendCents: money.nullable(),
  }),
};
export type FactKind = keyof typeof factPayloadSchemas;
export const datasetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const factFields = {
  datasetId: datasetIdSchema,
  factId: z
    .string()
    .regex(
      /^(?:[a-z][a-z_]{0,31}:)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ),
  revision: z.number().int().min(1).max(2147483647),
  effectiveAt: timestamp,
  recordedAt: timestamp,
  currency: z.literal("USD"),
  buyerKey: z
    .string()
    .regex(/^sole-buyer:v1:[a-f0-9]{64}$/)
    .nullable(),
  orderId: id.nullable(),
};

function variant<K extends FactKind>(kind: K) {
  return z.strictObject({
    ...factFields,
    kind: z.literal(kind),
    payload: factPayloadSchemas[kind],
  });
}
export const analyticsFactSchema = z.discriminatedUnion("kind", [
  variant("order"),
  variant("line"),
  variant("refund"),
  variant("refund_line"),
  variant("payment_attempt"),
  variant("shipping_cost"),
  variant("fee"),
  variant("fulfillment"),
  variant("inventory"),
  variant("customer_summary"),
]);
export type AnalyticsFact = z.infer<typeof analyticsFactSchema>;
export type OrderFact = Extract<AnalyticsFact, { kind: "order" }>;

export const datasetScopeSchema = z.strictObject({
  datasetId: datasetIdSchema,
  environment: z.enum(["staging", "production"]),
  activatedAt: timestamp,
  schemaVersion: z.literal(2),
  financialSource: z.enum(["events", "warehouse"]),
  behaviorArchiveCutoff: timestamp.nullable(),
});
export type DatasetScope = z.infer<typeof datasetScopeSchema>;
