import { parseReportRequest } from "../../../Source/Features/ReportContract/filters";
import type { PaymentMethod } from "../../../Source/Features/ReportContract/types";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { PostHogQueryError } from "../../../Source/Features/Reporting/posthog-query";
import { makeAudienceFixture } from "../Reporting/audience-fixture";
import { day } from "../Reporting/commerce-fixture";

const previous = "2026-06-09T12:00:00.000Z";
const zeroDate = "2026-06-08T12:00:00.000Z";
const fulfilled = "2026-06-11T13:01:05.000Z";

const selectedMethods = [
  ["card", 96, 1001],
  ["applePay", 60, 3050],
  ["googlePay", 40, 1000],
  ["afterpay", 24, 2000],
  ["cashAppPay", 15, 1500],
  ["unknown", 5, 2500],
] as const;

function order(
  method: PaymentMethod | null,
  value: number,
  fulfillment: "ship" | "pickup" | null = "ship",
) {
  return {
    grossMerchandiseCents: value,
    discountCents: 0,
    merchandiseCents: value,
    shippingCents: 0,
    taxCents: 0,
    totalCollectedCents: value,
    paymentMethod: method,
    fulfillment,
    status: "paid",
  };
}

function putPayments(f: ReturnType<typeof makeAudienceFixture>, reconciled: boolean) {
  for (const [method, count, cents] of selectedMethods) {
    for (let index = 0; index < count; index++) {
      const id = `${method}-${index}`;
      f.put("order", id, order(method, cents), { order: id });
      if (method === "card")
        f.put(
          "payment_attempt",
          id,
          {
            stage: "payment",
            method,
            outcome: "succeeded",
            reason: "none",
            resolvedAt: day,
          },
          { order: id },
        );
      if (method === "googlePay" || (method === "applePay" && index === 0))
        f.put(
          "fee",
          id,
          { adjustment: "charge", amountCents: method === "googlePay" ? 0 : 75 },
          { order: id },
        );
    }
  }
  for (let index = 0; index < 12; index++)
    f.put(
      "payment_attempt",
      `decline-${index}`,
      {
        stage: "payment",
        method: "card",
        outcome: "failed",
        reason: "declined",
        resolvedAt: day,
      },
      { order: null },
    );
  for (const outcome of ["pending", "unknown"])
    f.put(
      "payment_attempt",
      outcome,
      {
        stage: "payment",
        method: "card",
        outcome,
        reason: "timeout",
        resolvedAt: null,
      },
      { order: "card-0" },
    );
  if (reconciled)
    f.put(
      "payment_attempt",
      "unknown",
      {
        stage: "payment",
        method: "card",
        outcome: "failed",
        reason: "declined",
        resolvedAt: day,
      },
      { order: "card-0", revision: 2 },
    );
  f.put("order", "zero", order(null, 0), { order: "zero" });
  f.put("order", "zero-only", order(null, 0), { order: "zero-only", at: zeroDate });
  f.put("order", "prior-apple-1", order("applePay", 50), {
    order: "prior-apple-1",
    at: previous,
  });
  f.put("order", "prior-apple-2", order("applePay", 100), {
    order: "prior-apple-2",
    at: previous,
  });
  f.put("order", "prior-google", order("googlePay", 200), {
    order: "prior-google",
    at: previous,
  });
  f.link("prior-google", 12, previous);
}

function putHealth(f: ReturnType<typeof makeAudienceFixture>) {
  f.journey();
  f.put(
    "fulfillment",
    "shipping-state",
    {
      method: "ship",
      state: "shipped",
      paidAt: day,
      fulfilledAt: fulfilled,
    },
    { order: "ordered", revision: 2, at: fulfilled },
  );
  f.put(
    "fulfillment",
    "shipping-state",
    {
      method: "ship",
      state: "processing",
      paidAt: day,
      fulfilledAt: null,
    },
    { order: "ordered" },
  );
  f.put("order", "pickup", order("card", 565, "pickup"), { order: "pickup" });
  f.put(
    "fulfillment",
    "pickup-state",
    {
      method: "pickup",
      state: "processing",
      paidAt: day,
      fulfilledAt: null,
    },
    { order: "pickup" },
  );
  f.put("order", "finished-pickup", order("card", 400, "pickup"), {
    order: "finished-pickup",
  });
  f.put(
    "fulfillment",
    "finished-pickup-state",
    {
      method: "pickup",
      state: "picked_up",
      paidAt: null,
      fulfilledAt: day,
    },
    { order: "finished-pickup" },
  );
  f.put("order", "unknown-fulfillment", order("card", 200, null), {
    order: "unknown-fulfillment",
  });
  f.put("order", "prior", order("card", 100), { order: "prior", at: previous });
  f.put(
    "fulfillment",
    "prior-ship",
    {
      method: "ship",
      state: "unknown",
      paidAt: null,
      fulfilledAt: null,
    },
    { order: "prior", at: previous },
  );

  f.put(
    "payment_attempt",
    "expired",
    {
      stage: "reservation",
      outcome: "expired",
      reason: "inventory",
      resolvedAt: day,
      method: null,
    },
    { order: null },
  );
  f.put(
    "payment_attempt",
    "checkout-timeout",
    {
      stage: "checkout",
      outcome: "failed",
      reason: "timeout",
      resolvedAt: day,
      method: null,
    },
    { order: "ordered" },
  );
  f.put(
    "payment_attempt",
    "payment-timeout",
    {
      stage: "payment",
      outcome: "unknown",
      reason: "timeout",
      resolvedAt: null,
      method: "card",
    },
    { order: "ordered" },
  );
}

export type FixtureMode = "ready" | "reconciled" | "traffic-outage" | "provider-outage";

export async function loadPaymentHealthFixture<T extends "payments" | "health">(
  report: T,
  params: URLSearchParams,
  mode: FixtureMode = "ready",
) {
  const selected = parseReportRequest(params, new Date("2026-07-01T04:01:00Z"));
  if (selected.report !== report) throw new Error("Mismatched fixture report");
  const request = { ...selected, report };
  const f = makeAudienceFixture();
  try {
    if (report === "payments") putPayments(f, mode === "reconciled");
    else putHealth(f);
    const result = await getReport(request, {
      ...f.deps,
      execute(query) {
        if (
          mode === "provider-outage" ||
          (mode === "traffic-outage" &&
            query.endpoint.startsWith("sole_analytics_sessions"))
        )
          throw new PostHogQueryError({ status: "retryable", reason: "network" });
        return f.execute(query);
      },
    });
    return { request, result };
  } finally {
    f.db.close();
  }
}
