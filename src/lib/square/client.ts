import { SquareClient, SquareEnvironment } from "square";

import { getSquareConfig } from "@/lib/square/config";
import { SquareCheckoutOrdersGateway } from "@/lib/square/checkout-orders";
import { SquarePaymentsGateway } from "@/lib/square/payments";

export function createSquareClient(options?: {
  maxRetries: 0;
  fetch?: typeof fetch;
}): SquareClient {
  const config = getSquareConfig();

  return new SquareClient({
    token: config.accessToken,
    environment:
      config.environment === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
    maxRetries: options?.maxRetries ?? 2,
    fetch: options?.fetch,
    timeoutInSeconds: 10,
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
