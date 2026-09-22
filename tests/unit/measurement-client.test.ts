jest.mock("posthog-js", () => ({
  __esModule: true,
  default: { init: jest.fn(), capture: jest.fn() },
}));

import posthog from "posthog-js";

import {
  captureCheckoutStarted,
  captureProductAddedToCart,
  captureProductViewed,
  captureStorefrontViewed,
  filterOutgoingEvent,
  initializeMeasurement,
  resolveMeasurementConfig,
} from "@/lib/measurement/client";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const variantId = "123e4567-e89b-42d3-a456-426614174001";
const projectKey = `phc_${"a".repeat(24)}`;
const distinctId = "01990f14-c5f9-7bc8-9d22-f560a81f2381";
const sessionId = "01990f14-c5f9-7bc8-9d22-f560a81f2382";
const capture = jest.mocked(posthog.capture);
const init = jest.mocked(posthog.init);

describe("Phase A measurement client", () => {
  it("is disabled unless staging and valid project config are explicitly supplied", () => {
    expect(resolveMeasurementConfig({})).toBeNull();
    expect(
      resolveMeasurementConfig({
        enabled: "true",
        environment: "production",
        projectKey: `phc_${"a".repeat(24)}`,
        host: "https://us.i.posthog.com",
      }),
    ).toBeNull();
    expect(
      resolveMeasurementConfig({
        enabled: "true",
        environment: "staging",
        projectKey: "placeholder",
        host: "https://us.i.posthog.com",
      }),
    ).toBeNull();
    expect(
      resolveMeasurementConfig({
        enabled: "true",
        environment: "staging",
        projectKey: `phc_${"a".repeat(24)}`,
        host: "https://untrusted.example.com",
      }),
    ).toBeNull();
    captureProductViewed(productId);
    expect(capture).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
  });

  it("preserves only validated SDK ingestion and anonymous correlation fields", () => {
    const approved = filterOutgoingEvent(
      {
        event: "checkout_started",
        properties: {
          storefront: "sole",
          environment: "staging",
          schema_version: 1,
          pathname: "/checkout",
          token: projectKey,
          distinct_id: distinctId,
          $session_id: sessionId,
          $device_id: distinctId,
          $window_id: "01990f14-c5f9-7bc8-9d22-f560a81f2383",
          $current_url: "https://example.com/?token=sensitive",
          $referrer: "https://example.com/?email=person@example.com",
          email: "person@example.com",
          payment_token: "payment-secret",
        },
      },
      projectKey,
    );
    expect(approved?.properties).toEqual({
      storefront: "sole",
      environment: "staging",
      schema_version: 1,
      pathname: "/checkout",
      token: projectKey,
      distinct_id: distinctId,
      $session_id: sessionId,
    });
    expect(approved?.event).toBe("checkout_started");
    expect(
      filterOutgoingEvent(
        {
          event: "checkout_started",
          properties: {
            storefront: "sole",
            environment: "staging",
            schema_version: 1,
            pathname: "/checkout",
            token: `phc_${"b".repeat(24)}`,
            distinct_id: distinctId,
            $session_id: sessionId,
          },
        },
        projectKey,
      ),
    ).toBeNull();
    expect(
      filterOutgoingEvent(
        {
          event: "checkout_started",
          properties: {
            storefront: "sole",
            environment: "staging",
            schema_version: 1,
            pathname: "/checkout",
            token: projectKey,
            distinct_id: "not-a-uuid",
            $session_id: sessionId,
          },
        },
        projectKey,
      ),
    ).toBeNull();
    expect(
      filterOutgoingEvent(
        {
          event: "checkout_started",
          properties: {
            storefront: "sole",
            environment: "staging",
            schema_version: 1,
            pathname: "/checkout",
            token: projectKey,
            distinct_id: distinctId,
          },
        },
        projectKey,
      ),
    ).toBeNull();
    expect(
      filterOutgoingEvent(
        { event: "$pageview", properties: { token: projectKey } },
        projectKey,
      ),
    ).toBeNull();
  });

  it("captures only typed events after explicit initialization, without breaking on failure", () => {
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "true";
    process.env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT = "staging";
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY = `phc_${"a".repeat(24)}`;
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://us.i.posthog.com";
    const storage = new Map<string, string>();
    const browser = {
      location: new URL("https://shopsolesneakers.com/store"),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: browser,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { referrer: "https://search.example.org/?email=person@example.com" },
    });
    try {
      initializeMeasurement();
      expect(init).not.toHaveBeenCalled();
      browser.location = new URL(
        "https://soles-stg.vercel.app/store?utm_source=Google&token=sensitive",
      );
      initializeMeasurement();
      expect(init).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          disable_session_recording: true,
          disable_surveys: true,
          advanced_disable_flags: true,
          save_referrer: false,
          save_campaign_params: false,
          before_send: expect.any(Function),
        }),
      );
      expect([...storage.values()].join(" ")).not.toContain("sensitive");
      captureStorefrontViewed();
      expect(capture).toHaveBeenCalledWith(
        "storefront_viewed",
        expect.objectContaining({
          storefront: "sole",
          environment: "staging",
          schema_version: 1,
          pathname: "/store",
          utm_source: "google",
          referrer_host: "search.example.org",
        }),
      );
      browser.location.pathname = `/store/${productId}`;
      captureProductViewed(productId);
      captureProductAddedToCart(productId, variantId);
      expect(capture).toHaveBeenCalledWith(
        "product_viewed",
        expect.objectContaining({
          product_id: productId,
        }),
      );
      expect(capture).toHaveBeenCalledWith(
        "product_added_to_cart",
        expect.objectContaining({
          product_id: productId,
          variant_id: variantId,
          quantity: 1,
        }),
      );
      browser.location.pathname = "/checkout";
      captureCheckoutStarted();
      expect(capture).toHaveBeenCalledWith(
        "checkout_started",
        expect.objectContaining({
          pathname: "/checkout",
        }),
      );
      capture.mockImplementationOnce(() => {
        throw new Error("SDK unavailable");
      });
      expect(() => captureCheckoutStarted()).not.toThrow();
    } finally {
      delete (globalThis as { window?: Window }).window;
      delete (globalThis as { document?: Document }).document;
      delete process.env.NEXT_PUBLIC_POSTHOG_ENABLED;
      delete process.env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT;
      delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY;
      delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    }
  });
});
