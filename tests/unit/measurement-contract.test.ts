import {
  extractSafeAttribution,
  sanitizeMeasurementEvent,
} from "@/lib/measurement/contract";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const variantId = "123e4567-e89b-42d3-a456-426614174001";
const common = {
  storefront: "sole",
  environment: "staging",
  schema_version: 1,
};

describe("Phase A event contract", () => {
  it("rejects storefront_viewed on / and accepts only /store", () => {
    expect(
      sanitizeMeasurementEvent("storefront_viewed", { ...common, pathname: "/" }),
    ).toBeNull();
    expect(
      sanitizeMeasurementEvent("storefront_viewed", { ...common, pathname: "/store" }),
    ).not.toBeNull();
  });

  it("accepts only the four approved event schemas", () => {
    expect(
      sanitizeMeasurementEvent("storefront_viewed", { ...common, pathname: "/store" }),
    ).toMatchObject({ event: "storefront_viewed" });
    expect(
      sanitizeMeasurementEvent("product_viewed", {
        ...common,
        pathname: `/store/${productId}`,
        product_id: productId,
      }),
    ).toMatchObject({ event: "product_viewed" });
    expect(
      sanitizeMeasurementEvent("product_added_to_cart", {
        ...common,
        pathname: `/store/${productId}`,
        product_id: productId,
        variant_id: variantId,
        quantity: 1,
      }),
    ).toMatchObject({ event: "product_added_to_cart" });
    expect(
      sanitizeMeasurementEvent("checkout_started", { ...common, pathname: "/checkout" }),
    ).toMatchObject({ event: "checkout_started" });
    expect(
      sanitizeMeasurementEvent("order_completed", { ...common, pathname: "/checkout" }),
    ).toBeNull();
  });

  it("strips unknown, SDK-added, and sensitive properties", () => {
    const result = sanitizeMeasurementEvent("product_viewed", {
      ...common,
      pathname: `/store/${productId}`,
      product_id: productId,
      email: "person@example.com",
      payment_token: "sensitive",
      $current_url: "https://example.com/store?token=sensitive",
      $referrer: "https://example.com/?email=person@example.com",
      arbitrary: "value",
    });
    expect(result?.properties).toEqual({
      ...common,
      pathname: `/store/${productId}`,
      product_id: productId,
    });
  });

  it("fails closed on invalid common fields or identifiers", () => {
    expect(
      sanitizeMeasurementEvent("checkout_started", {
        ...common,
        environment: "production",
        pathname: "/checkout",
      }),
    ).toBeNull();
    expect(
      sanitizeMeasurementEvent("product_viewed", {
        ...common,
        pathname: `/store/${productId}`,
        product_id: "not-a-uuid",
      }),
    ).toBeNull();
    expect(
      sanitizeMeasurementEvent("product_added_to_cart", {
        ...common,
        pathname: `/store/${productId}`,
        product_id: productId,
        variant_id: variantId,
        quantity: 2,
      }),
    ).toBeNull();
    expect(
      sanitizeMeasurementEvent("checkout_started", {
        ...common,
        pathname: "/checkout?token=sensitive",
      }),
    ).toBeNull();
  });
});

describe("safe source extraction", () => {
  it("keeps only allowed, sanitized source fields", () => {
    expect(
      extractSafeAttribution(
        "https://shop.example.com/store?utm_source=Google&utm_medium=cpc&utm_campaign=Fall_2026&token=secret&utm_extra=ignored",
        "https://search.example.org/results?email=person@example.org",
      ),
    ).toEqual({
      landing_pathname: "/store",
      referrer_host: "search.example.org",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "fall_2026",
    });
  });

  it("rejects token-like, duplicate, and URL-valued parameters", () => {
    expect(
      extractSafeAttribution(
        "https://shop.example.com/store?utm_source=ok&utm_source=duplicate&utm_campaign=person%40example.com&utm_term=https%3A%2F%2Fevil.example%2F&guestToken=sensitive",
        "not a URL",
      ),
    ).toEqual({ landing_pathname: "/store" });
  });

  it("never retains an arbitrary path or query string", () => {
    expect(
      extractSafeAttribution(
        "https://shop.example.com/order-status/secret?token=sensitive",
        "https://ref.example.com/path?token=sensitive",
      ),
    ).toEqual({ referrer_host: "ref.example.com" });
  });
});
