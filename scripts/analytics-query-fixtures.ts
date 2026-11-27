// Owner-side staging verification only. The application report path never imports this module.
import { z } from "zod";
import { sourceCoverageSchema } from "../src/Modules/Analytics/Source/Features/EventDelivery/reconcile";
import {
  expectedEvidence,
  SNAPSHOT_LIMIT,
  sourcePublication,
} from "../src/Modules/Analytics/Source/Features/EventDelivery/reconciliation-evidence";
import { analyticsInstantMicros } from "../src/Modules/Analytics/Source/Features/EventDelivery/instant";

const money = z.strictObject({
  cents: z.number().int().nullable(),
  complete: z.boolean(),
  missingCount: z.number().int().nonnegative(),
});
const sales = z.looseObject({
  grossMerchandise: money,
  discounts: money,
  merchandiseRefunds: money,
  netMerchandise: money,
  netShipping: money,
  netTax: money,
  totalCollected: money,
  unallocatedRefunds: money,
  recordedProfit: money,
  confirmedOrders: z.number().int().nonnegative(),
});
const windowSchema = z.strictObject({
  scenario: z.enum(["golden", "unallocated", "corrected", "refund-only"]),
  from: z.iso.date(),
  to: z.iso.date(),
  sales,
  payments: z.object({}).passthrough(),
  health: z.object({}).passthrough(),
});
const golden = {
  grossMerchandise: 4800000,
  discounts: 480000,
  merchandiseRefunds: 90000,
  netMerchandise: 4230000,
  netShipping: 172500,
  netTax: 329700,
  totalCollected: 4732200,
  unallocatedRefunds: 0,
};
const expected = {
  golden,
  unallocated: { ...golden, totalCollected: 4722200, unallocatedRefunds: 10000 },
  corrected: {
    ...golden,
    totalCollected: 4722200,
    merchandiseRefunds: 100000,
    netMerchandise: 4220000,
  },
  "refund-only": {
    grossMerchandise: 0,
    discounts: 0,
    merchandiseRefunds: 90000,
    netMerchandise: -90000,
    netShipping: -7500,
    netTax: -300,
    totalCollected: -97800,
    unallocatedRefunds: 0,
  },
};
const incompleteComponents = new Set([
  "merchandiseRefunds",
  "netMerchandise",
  "netShipping",
  "netTax",
]);
export function validateQueryFixtures(raw: unknown) {
  const windows = z
    .array(windowSchema)
    .length(4)
    .parse(raw)
    .sort((a, b) => a.from.localeCompare(b.from));
  if (new Set(windows.map((w) => w.scenario)).size !== 4)
    throw new Error("Missing financial scenario");
  for (const [i, w] of windows.entries()) {
    if (w.from > w.to || (i > 0 && windows[i - 1].to >= w.from))
      throw new Error("Overlapping or invalid fixture windows");
    if (w.sales.confirmedOrders !== (w.scenario === "refund-only" ? 0 : 1))
      throw new Error("Invalid fixture order count");
    for (const key of Object.keys(golden) as (keyof typeof golden)[]) {
      const observed = w.sales[key],
        complete = !(w.scenario === "unallocated" && incompleteComponents.has(key));
      if (
        observed.cents !== expected[w.scenario][key] ||
        observed.complete !== complete ||
        (observed.missingCount === 0) !== complete
      )
        throw new Error("Invalid fixture component");
    }
    if (
      w.scenario === "unallocated" &&
      (w.sales.recordedProfit.complete || w.sales.recordedProfit.missingCount === 0)
    )
      throw new Error("Missing refund allocation coverage");
  }
  return windows;
}

const snapshot = sourceCoverageSchema.extend({
  publications: z.array(sourcePublication).max(SNAPSHOT_LIMIT),
});
export function verifyFixtureCorrection(
  raw: unknown,
  dataset: string,
  start: string,
  end: string,
) {
  const evidence = snapshot.parse(raw);
  const facts = expectedEvidence(evidence.publications, dataset, start, end);
  if (facts.raw.size !== evidence.revisions || facts.warehouse.size !== evidence.facts)
    throw new Error("Incomplete correction fixture snapshot");
  const candidates = [...facts.warehouse.values()]
    .map((row) => row.fact)
    .filter((f) => f.kind === "refund" && f.payload.totalCents === 10000);
  if (candidates.length !== 1) throw new Error("Ambiguous correction fixture");
  const latest = candidates[0];
  if (
    latest.kind !== "refund" ||
    latest.payload.unallocatedCents !== 0 ||
    latest.payload.merchandiseCents !== 10000 ||
    latest.payload.shippingCents !== 0 ||
    latest.payload.taxCents !== 0
  )
    throw new Error("Missing final refund allocation");
  const previous = evidence.publications.some(
    ({ fact }) =>
      fact.kind === "refund" &&
      fact.factId === latest.factId &&
      fact.orderId === latest.orderId &&
      fact.payload.refundId === latest.payload.refundId &&
      fact.revision < latest.revision &&
      analyticsInstantMicros(fact.effectiveAt) ===
        analyticsInstantMicros(latest.effectiveAt) &&
      fact.payload.totalCents === 10000 &&
      fact.payload.unallocatedCents === 10000 &&
      fact.payload.merchandiseCents === null &&
      fact.payload.shippingCents === null &&
      fact.payload.taxCents === null,
  );
  if (!previous) throw new Error("Missing original unallocated revision");
}
