import { z } from "zod";

const squareConfigSchema = z
  .object({
    SQUARE_ENVIRONMENT: z.enum(["sandbox", "production"]),
    SQUARE_ACCESS_TOKEN: z.string().trim().min(1),
    SQUARE_LOCATION_ID: z.string().trim().min(1),
    SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().trim().min(1),
    SQUARE_WEBHOOK_NOTIFICATION_URL: z.string().url(),
  })
  .superRefine((value, context) => {
    const webhookUrl = new URL(value.SQUARE_WEBHOOK_NOTIFICATION_URL);
    if (
      webhookUrl.protocol !== "https:" ||
      webhookUrl.pathname !== "/api/webhooks/square" ||
      webhookUrl.search ||
      webhookUrl.hash
    ) {
      context.addIssue({
        code: "custom",
        path: ["SQUARE_WEBHOOK_NOTIFICATION_URL"],
        message: "must be the exact HTTPS Square webhook endpoint",
      });
    }
  });

export type SquareConfig = {
  environment: "sandbox" | "production";
  accessToken: string;
  locationId: string;
  webhookSignatureKey: string;
  webhookNotificationUrl: string;
};

export function parseSquareConfig(
  source: Record<string, string | undefined>,
): SquareConfig {
  const parsed = squareConfigSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error("square_configuration_invalid");
  }

  return {
    environment: parsed.data.SQUARE_ENVIRONMENT,
    accessToken: parsed.data.SQUARE_ACCESS_TOKEN,
    locationId: parsed.data.SQUARE_LOCATION_ID,
    webhookSignatureKey: parsed.data.SQUARE_WEBHOOK_SIGNATURE_KEY,
    webhookNotificationUrl: parsed.data.SQUARE_WEBHOOK_NOTIFICATION_URL,
  };
}

export function getSquareConfig(): SquareConfig {
  return parseSquareConfig(process.env);
}
