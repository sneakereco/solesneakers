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
test("new and returning buyer outcome counts use both boundaries of each activity period", async () => {
  const f = fixture();
  for (const [id, purchase] of [
    ["old", older],
    ["prior", "2026-06-09T04:00:00.000Z"],
    ["current", "2026-06-10T04:00:00.000Z"],
    ["future", "2026-06-11T04:00:00.000Z"],
  ]) {
    f.put("order", id, sale, { at: purchase, order: id, buyer: id });
    for (const [d, at] of [
      ["9", "2026-06-09T13:00:00.000Z"],
      ["10", day],
    ]) {
      f.put(
        "payment_attempt",
        id + d,
        {
          stage: "payment",
          method: "card",
          outcome: "failed",
          reason: "declined",
          resolvedAt: at,
        },
        { at, order: id, buyer: id },
      );
    }
  }
  const n = (await f.report("health", "customer=new&compare=true")) as HealthData;
  expect(n.outcomes[0].count).toBe(1);
  expect(n.comparison?.outcomes[0].count).toBe(1);
  const r = (await f.report("health", "customer=returning&compare=true")) as HealthData;
  expect(r.outcomes[0].count).toBe(2);
  expect(r.comparison?.outcomes[0].count).toBe(1);
});
