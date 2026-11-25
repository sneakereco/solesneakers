export const OPERATION_BUDGETS = Object.freeze({
  catalog: [1000, 2000],
  cart_validate: [1000, 2000],
  order_poll: [1000, 2000],
  quote: [3000, 5000],
  prepare: [3000, 5000],
  permit: [3000, 5000],
  pay: [3000, 5000],
  page: [1500, 3000],
  claim: [3000, 10000],
});
export function buildThresholds(plan) {
  const thresholds = {
    dropped_iterations: ["count==0"],
    business_violations: ["count==0"],
    eligible_checkout_completed: ["rate>=0.99"],
  };
  for (const [operation, [p95, p99]] of Object.entries(OPERATION_BUDGETS)) {
    if (operation === "claim" && plan?.profile !== "claim-rush") continue;
    thresholds[`http_req_duration{operation:${operation},outcome:success}`] = [
      `p(95)<${p95}`,
      `p(99)<${p99}`,
    ];
    thresholds[`technical_failure{operation:${operation}}`] = ["rate<0.01"];
  }
  return thresholds;
}
export function evaluateThreshold(operation, metrics) {
  const budget = OPERATION_BUDGETS[operation];
  if (!budget) return { status: "unmet", reasons: ["Unknown operation"] };
  if (
    ![metrics.p95, metrics.p99, metrics.failureRate].every(
      (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
    )
  )
    return { status: "unmet", reasons: ["Missing operation measurements"] };
  const reasons = [];
  if (metrics.p95 >= budget[0]) reasons.push("p95 exceeded");
  if (metrics.p99 >= budget[1]) reasons.push("p99 exceeded");
  if (metrics.failureRate >= 0.01)
    reasons.push("Unexpected technical failure budget exceeded");
  return { status: reasons.length ? "fail" : "pass", reasons };
}
