import type { LoadTestContext } from "./context";
import { createLoadTestSquareFetch } from "./square-adapter";
import { createLoadTestShippingFetch } from "./shipping-adapter";
import { captureLoadTestEmail, type LoadTestMail } from "./mail-sink";
import { readLoadTestSettings, type LoadTestSettings } from "./settings";
import type { RunStore } from "./run-store";

export function selectLoadTestProviders(
  context: LoadTestContext | null,
  store: RunStore | null,
  settings: LoadTestSettings | null = readLoadTestSettings(),
  locationId = "load-location",
) {
  if (!settings || settings.target.providerMode !== "simulated") return null;
  if (!store) throw new Error("Missing load-test registry");
  return {
    squareFetch: createLoadTestSquareFetch(context, store, settings, locationId),
    shippingFetch: context ? createLoadTestShippingFetch(context, store) : null,
    captureEmail: (input: LoadTestMail) => captureLoadTestEmail(input, settings, store),
  };
}
