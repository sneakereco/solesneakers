import { deadlineFetch } from "@/Modules/Checkout/Source/Features/Recovery/recovery-worker";
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
    logging: { silent: true },
    environment:
      config.environment === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
    maxRetries: options?.maxRetries ?? 2,
    fetch: options?.fetch,
    timeoutInSeconds: 10,
  });
}

// Interactive provider calls must settle inside their PostgreSQL capacity lease.
export function createSquareCheckoutOrdersGateway(
  signal: AbortSignal,
): SquareCheckoutOrdersGateway {
  const config = getSquareConfig();
  const client = createSquareClient({ maxRetries: 0, fetch: deadlineFetch(signal) });
  return new SquareCheckoutOrdersGateway(client.orders, config.locationId);
}

export function createSquarePaymentsGateway(signal: AbortSignal): SquarePaymentsGateway {
  const config = getSquareConfig();
  const client = createSquareClient({ maxRetries: 0, fetch: deadlineFetch(signal) });
  return new SquarePaymentsGateway(client.payments, config.locationId);
}
