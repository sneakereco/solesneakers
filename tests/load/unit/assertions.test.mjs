import test from "node:test";
import assert from "node:assert/strict";
import { assertRunInvariants } from "../operator/assertions.mjs";
function evidence(stock = 1) {
  return {
    variants: [
      { id: "v", initial: stock, stock: 0, active: 0, consumed: stock, hot: true },
    ],
    orders: Array.from({ length: stock }, (_, i) => ({
      id: `o${i}`,
      status: "paid",
      totalCents: 1000,
      itemCents: 1000,
      shippingCents: 0,
      taxCents: 0,
      itemCount: 1,
      hasSnapshot: true,
    })),
    captures: Array.from({ length: stock }, (_, i) => ({
      id: `p${i}`,
      orderId: `o${i}`,
      status: "COMPLETED",
      totalCents: 1000,
    })),
    acceptedOrderIds: Array.from({ length: stock }, (_, i) => `o${i}`),
    claims: null,
    receiptEvidence: true,
  };
}
test("durable winners equal stock 1 10 100 and accepted outcomes survive", () => {
  for (const hotStock of [1, 10, 100])
    assert.equal(
      assertRunInvariants(evidence(hotStock), { profile: "rush", hotStock }).status,
      "pass",
    );
  const report = evidence();
  report.orders = [];
  assert.equal(
    assertRunInvariants(report, { profile: "rush", hotStock: 1 }).status,
    "fail",
  );
});
test("duplicate capture oversell conservation and missing receipt evidence fail independently", () => {
  for (const mutate of [
    (r) => r.captures.push({ ...r.captures[0], id: "p2" }),
    (r) => (r.variants[0].stock = -1),
    (r) => (r.variants[0].consumed = 2),
    (r) => (r.orders[0].totalCents = 1200),
  ]) {
    const report = evidence();
    mutate(report);
    assert.equal(
      assertRunInvariants(report, { profile: "rush", hotStock: 1 }).status,
      "fail",
    );
  }
  const report = evidence();
  report.receiptEvidence = false;
  assert.equal(
    assertRunInvariants(report, { profile: "rush", hotStock: 1 }).status,
    "unmet",
  );
});
test("specialty evidence cannot pass without real claim contract and durable rows", () => {
  assert.equal(
    assertRunInvariants(evidence(), { profile: "claim-rush" }).status,
    "unmet",
  );
});
test("one provider payment ID cannot conceal contradictory durable ownership", () => {
  const report = evidence();
  report.captures.push({ ...report.captures[0], orderId: "another-order" });
  assert.equal(
    assertRunInvariants(report, { profile: "rush", hotStock: 1 }).status,
    "fail",
  );
});
