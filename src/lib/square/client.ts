import { SquareClient, SquareEnvironment } from "square";

import { getSquareConfig } from "@/lib/square/config";
import { SquareCheckoutOrdersGateway } from "@/lib/square/checkout-orders";
import { SquarePaymentsGateway } from "@/lib/square/payments";
import { getActiveLoadTestContext } from "@/Modules/Checkout/Source/Features/LoadTesting/context";
import { readLoadTestSettings } from "@/Modules/Checkout/Source/Features/LoadTesting/settings";
import { createLoadRunStore } from "@/Modules/Checkout/Source/Features/LoadTesting/run-store";
import { selectLoadTestProviders } from "@/Modules/Checkout/Source/Features/LoadTesting/provider-selection";

export function createSquareClient(): SquareClient {
  const config = getSquareConfig();
  const settings = readLoadTestSettings();
  const simulation = selectLoadTestProviders(
    getActiveLoadTestContext(),
    settings ? createLoadRunStore(settings) : null,
    settings,
    config.locationId,
  );

  return new SquareClient({
    token: config.accessToken,
    environment:
      config.environment === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
    maxRetries: 2,
    timeoutInSeconds: 10,
    ...(simulation ? { fetch: simulation.squareFetch } : {}),
  });
}

export function createSquareCheckoutOrdersGateway(): SquareCheckoutOrdersGateway {
  const config = getSquareConfig();
  const client = createSquareClient();
  return new SquareCheckoutOrdersGateway(client.orders, config.locationId);
}

export function createSquarePaymentsGateway(): SquarePaymentsGateway {
  const config = getSquareConfig();
  const client = createSquareClient();
  return new SquarePaymentsGateway(client.payments, config.locationId);
}
