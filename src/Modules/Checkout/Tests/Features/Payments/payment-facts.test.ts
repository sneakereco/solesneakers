import {
  projectOrderFinancialState,
  type VerifiedFinancialFact,
} from "../../../Source/Features/Payments/payment-facts";

const capture: VerifiedFinancialFact = {
  kind: "payment",
  orderId: "4ed3206e-8b44-4c82-b71d-b34996f73b79",
  providerId: "payment1",
  paymentId: "payment1",
  providerVersion: "z",
  status: "COMPLETED",
  amountCents: 1000,
  currency: "USD",
  expectedTotalCents: 1000,
  fulfillmentStatus: "shipped",
};
const refund = (providerId: string, amountCents: number): VerifiedFinancialFact => ({
  ...capture,
  kind: "refund",
  providerId,
  amountCents,
});
it("projects the same capture and distinct refund totals in either order", () => {
  const facts = [
    refund("first", 350),
    refund("second", 650),
    capture,
    refund("first", 350),
    { ...capture, providerVersion: "a" },
  ];
  const snapshot = projectOrderFinancialState(facts);
  expect(snapshot).toMatchObject({
    financialState: "refunded",
    capturedCents: 1000,
    refundedCents: 1000,
    fulfillmentStatus: "shipped",
    reviewReason: null,
  });
  expect(projectOrderFinancialState(facts.reverse())).toEqual(snapshot);
});
it("requires a fresh provider observation for contradictory completed amounts on one refund", () => {
  expect(() =>
    projectOrderFinancialState([
      capture,
      refund("one", 400),
      { ...refund("one", 500), providerVersion: "a" },
    ]),
  ).toThrow("refund_refresh_required");
});
it("preserves prior settlement while flagging contradictory immutable amounts", () => {
  const snap = projectOrderFinancialState([
    capture,
    { ...capture, amountCents: 1200, providerVersion: "b" },
  ]);
  expect(snap).toMatchObject({
    capturedCents: 1000,
    financialState: "paid",
    reviewReason: "square_amount_conflict",
  });
});
it("retains the successful payment when a different declined attempt is replayed", () => {
  const declined = {
    ...capture,
    paymentId: "earlier",
    providerId: "earlier",
    status: "FAILED",
  } as const;
  expect(projectOrderFinancialState([declined, capture, declined])).toMatchObject({
    capturedCents: 1000,
    financialState: "paid",
    reviewReason: null,
  });
});
it.each([false, true])(
  "retains confirmed money and review for terminal disagreement, reversed %s",
  (reverse) => {
    const done = refund("r", 400);
    const denied = { ...done, providerVersion: "other", status: "FAILED" } as const;
    const facts = reverse ? [done, denied] : [denied, done];
    expect(projectOrderFinancialState([capture, ...facts])).toMatchObject({
      refundedCents: 400,
      financialState: "partially_refunded",
      reviewReason: "square_status_conflict",
    });
  },
);
