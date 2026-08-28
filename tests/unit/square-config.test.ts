import { parseSquareConfig } from "@/lib/square/config";

const validConfig = {
  SQUARE_ENVIRONMENT: "sandbox",
  SQUARE_ACCESS_TOKEN: "sandbox-token",
  SQUARE_LOCATION_ID: "location-1",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "signature-key",
  SQUARE_WEBHOOK_NOTIFICATION_URL: "https://preview.example.com/api/webhooks/square",
};

describe("parseSquareConfig", () => {
  it("returns an explicit sandbox configuration", () => {
    expect(parseSquareConfig(validConfig)).toEqual({
      environment: "sandbox",
      accessToken: "sandbox-token",
      locationId: "location-1",
      webhookSignatureKey: "signature-key",
      webhookNotificationUrl: "https://preview.example.com/api/webhooks/square",
    });
  });

  it("fails closed when any payment or webhook credential is missing", () => {
    expect(() =>
      parseSquareConfig({
        ...validConfig,
        SQUARE_WEBHOOK_SIGNATURE_KEY: "",
      }),
    ).toThrow("square_configuration_invalid");
  });

  it("requires the exact Square webhook route", () => {
    expect(() =>
      parseSquareConfig({
        ...validConfig,
        SQUARE_WEBHOOK_NOTIFICATION_URL: "https://preview.example.com/api/webhooks",
      }),
    ).toThrow("square_configuration_invalid");
  });
});
