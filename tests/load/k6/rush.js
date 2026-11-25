import { sleep } from "k6";
import { config, sessions, shopperSession } from "./shopping.js";
import { createTransport, initializeCookies } from "./lib/http.js";
import { logicalSession } from "./lib/session.js";
import { emit } from "./lib/metrics.js";
import { runCheckoutJourney, requestOperation } from "../shared/journeys.mjs";
export { options, setup } from "./shopping.js";
let participated = false;
export async function rushSession() {
  const slot = config.shard.start + __VU - 1;
  if (slot >= config.shard.end) throw Error("Rush slot outside worker lease");
  if (slot >= config.plan.contenders || participated) return shopperSession();
  participated = true;
  const identity = sessions[__VU - 1];
  initializeCookies(config, identity);
  if (config.plan.contentionKind !== "purchase")
    throw Error(
      "Actual specialty claim contract is required; checkout fallback forbidden",
    );
  const session = logicalSession(config, slot, 0, identity),
    hot = config.fixtures.products.find((x) => x.hot);
  session.items = [{ productId: hot.id, variantId: hot.variantId, quantity: 1 }];
  session.productId = hot.id;
  session.isRush = true;
  const transport = createTransport(config, slot),
    started = Date.now();
  emit("session_started", 1);
  emit("active_delta", 1);
  let success = false;
  try {
    if (config.plan.profile === "rush")
      session.primedQuote = await requestOperation(
        transport,
        "quote",
        "/api/checkout/quote",
        {
          items: session.items,
          fulfillment: session.fulfillment,
          shippingAddress: session.fulfillment === "ship" ? session.address : null,
        },
        (x) => x?.completeness === "exact" && /^[a-f0-9]{64}$/.test(x.quoteFingerprint),
      );
    if (Date.now() > config.phaseStart)
      throw Error("Rush contender was not ready before opening");
    sleep((config.phaseStart - Date.now()) / 1000);
    const original = transport.request;
    transport.request = (input) => {
      if (input.operation === (config.plan.profile === "rush" ? "prepare" : "quote"))
        emit("rush_dispatch", Date.now());
      return original(input);
    };
    const result = await runCheckoutJourney(session, config.plan, transport);
    success = ["completed", "stock-conflict"].includes(result.classification);
    const end = config.phaseStart + config.plan.measurementSeconds * 1000;
    if (Date.now() < end) sleep((end - Date.now()) / 1000);
  } catch {
    emit("session_interrupted", 1);
  } finally {
    emit("active_delta", -1);
    emit("session_duration_ms", Date.now() - started);
    if (success) emit("session_completed", 1);
  }
}
export default rushSession;
