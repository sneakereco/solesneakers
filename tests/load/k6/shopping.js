import { SharedArray } from "k6/data";
import { sleep } from "k6";
import {
  runCatalogJourney,
  runCartJourney,
  runCheckoutJourney,
  requestOperation,
} from "../shared/journeys.mjs";
import { createTransport, initializeCookies } from "./lib/http.js";
import { logicalSession } from "./lib/session.js";
import { emit } from "./lib/metrics.js";
// The large customer-cookie partition lives once per worker, not per VU.
const metadata = new SharedArray("run-metadata", () => {
  const raw = JSON.parse(open(__ENV.LOAD_RUN_CONFIG));
  const fixtures = { ...raw.fixtures };
  delete fixtures.sessions;
  return [{ ...raw, fixtures }];
});
export const config = metadata[0];
export const sessions = new SharedArray(
  "private-slot-sessions",
  () => JSON.parse(open(__ENV.LOAD_RUN_CONFIG)).fixtures.sessions,
);
export const options = JSON.parse(JSON.stringify(config.options));
export function setup() {
  if (!config.baseUrl || !config.credential || !config.shard)
    throw Error("Missing enrolled worker config");
  console.log("LOAD_WORKER_READY");
}
let generation = 0,
  initialized = false,
  lastAuth = 0;
export async function shopperSession() {
  const slot = config.shard.start + __VU - 1;
  if (slot >= config.shard.end) throw Error("Worker exceeded leased slot range");
  const identity = sessions[__VU - 1];
  if (!initialized) {
    initializeCookies(config, identity);
    initialized = true;
  }
  if (Date.now() < config.phaseStart) sleep((config.phaseStart - Date.now()) / 1000);
  const session = logicalSession(config, slot, generation++, identity),
    transport = createTransport(config, slot);
  const started = Date.now(),
    duration =
      config.plan.sessionSeconds[0] +
      Math.random() * (config.plan.sessionSeconds[1] - config.plan.sessionSeconds[0]);
  let succeeded = true;
  emit("session_started", 1);
  emit("active_delta", 1);
  try {
    if (identity?.accountId && Date.now() - lastAuth > 10 * 60000) {
      await requestOperation(
        transport,
        "catalog",
        "/api/auth/session",
        null,
        (x) => x?.user?.id === identity.accountId,
      );
      lastAuth = Date.now();
    }
    const role =
      config.plan.httpSlots < 20 && slot === config.plan.httpSlots - 1 ? 95 : slot % 100;
    let checkedOut = false;
    do {
      await runCatalogJourney(session, config.plan, transport, {
        search: role >= 55 && role < 80,
      });
      if (role >= 80) await runCartJourney(session, config.plan, transport);
      if (role >= 95 && !checkedOut) {
        const outcome = await runCheckoutJourney(session, config.plan, transport);
        checkedOut = true;
        if (
          !["completed", "stock-conflict", "stock-unavailable"].includes(
            outcome.classification,
          )
        )
          succeeded = false;
      }
    } while (
      Date.now() - started < duration * 1000 &&
      Date.now() < Date.parse(config.plan.deadline)
    );
  } catch {
    emit("session_interrupted", 1);
    succeeded = false;
  } finally {
    emit("active_delta", -1);
    emit("session_duration_ms", Date.now() - started);
    if (succeeded) emit("session_completed", 1);
  }
}
export const arrivalSession = shopperSession;
export default shopperSession;
