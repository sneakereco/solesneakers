import { Counter, Rate, Trend } from "k6/metrics";
const metrics = {
  operation_ms: new Trend("operation_ms", true),
  technical_failure: new Rate("technical_failure"),
  operation_offered: new Counter("operation_offered"),
  operation_completed: new Counter("operation_completed"),
  eligible_checkout_completed: new Rate("eligible_checkout_completed"),
  business_violations: new Counter("business_violations"),
  stock_unavailable: new Counter("stock_unavailable"),
  accepted_order: new Counter("accepted_order"),
  session_checkout_ms: new Trend("session_checkout_ms", true),
  session_started: new Counter("session_started"),
  session_completed: new Counter("session_completed"),
  session_interrupted: new Counter("session_interrupted"),
  session_duration_ms: new Trend("session_duration_ms", true),
  active_delta: new Trend("active_delta"),
  rush_dispatch: new Trend("rush_dispatch"),
};
export const emit = (name, value, tags = {}) => {
  if (!metrics[name]) throw Error(`Unknown metric ${name}`);
  metrics[name].add(value, tags);
};
