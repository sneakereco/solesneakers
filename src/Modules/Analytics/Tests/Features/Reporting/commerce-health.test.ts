import { fixture, sale, day, older } from "./commerce-fixture";
import type { HealthData } from "../../../Source/Features/ReportContract/types";
test("health uses latest fulfillment states of orders in confirmation range and real elapsed time", async () => {
  const f = fixture();
  f.put("order", "o", sale);
  const state = { method: "ship", state: "processing", paidAt: day, fulfilledAt: null };
  f.put(
    "fulfillment",
    "f",
    { ...state, state: "shipped", fulfilledAt: "2026-06-10T13:00:00.000Z" },
    { revision: 2 },
  );
  f.put("fulfillment", "f", state);
  f.put("order", "p", { ...sale, fulfillment: "pickup" }, { order: "p" });
  f.put("fulfillment", "p", { ...state, method: "pickup" }, { order: "p" });
  f.put(
    "payment_attempt",
    "a",
    {
      stage: "reservation",
      outcome: "expired",
      reason: "inventory",
      resolvedAt: day,
      method: null,
    },
    { at: older, order: null },
  );
  const h = (await f.report("health")) as HealthData;
  expect(h.fulfillmentPreference).toEqual({ ship: 1, pickup: 1, unknown: 0 });
  expect(h.outcomes).toEqual([
    { stage: "reservation", reason: "inventory", outcome: "expired", count: 1 },
  ]);
  expect(h.backlog.find((s) => s.fulfillment === "pickup")).toEqual({
    fulfillment: "pickup",
    state: "processing",
    count: 1,
  });
  expect(h.paymentToFulfillment.find((s) => s.fulfillment === "ship")).toEqual({
    fulfillment: "ship",
    fulfilledOrders: 1,
    medianSeconds: 3600,
    p90Seconds: 3600,
  });
  expect(h.funnel[0].sessions).toBeNull();
});
