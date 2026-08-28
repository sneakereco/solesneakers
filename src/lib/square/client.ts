import { SquareClient, SquareEnvironment } from "square";

import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { getSquareConfig } from "@/lib/square/config";
import { SquarePaymentLinksGateway } from "@/lib/square/payment-links";

export function createSquareClient(): SquareClient {
  const config = getSquareConfig();

  return new SquareClient({
    token: config.accessToken,
    environment:
      config.environment === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
    maxRetries: 2,
    timeoutInSeconds: 10,
  });
}

export function createSquarePaymentLinksGateway(): SquarePaymentLinksGateway {
  const config = getSquareConfig();
  const client = createSquareClient();

  return new SquarePaymentLinksGateway(
    client.checkout.paymentLinks,
    config.locationId,
    SUPPORT_EMAIL,
  );
}
