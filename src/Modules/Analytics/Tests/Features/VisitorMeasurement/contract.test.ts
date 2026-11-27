import {
  safeSlug,
  safeReferrerHost,
  sanitizeMeasurementEvent,
} from "@/Modules/Analytics/Source/Features/VisitorMeasurement/contract";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const variantId = "123e4567-e89b-42d3-a456-426614174001";
const common = {
  storefront: "sole",
  environment: "staging",
  schema_version: 2,
};

describe("Behavior event contract", () => {
  it("rejects storefront_viewed on / and accepts only /store", () => {
    expect(
      sanitizeMeasurementEvent("storefront_viewed", { ...common, pathname: "/" }),
    ).toBeNull();
    expect(
      sanitizeMeasurementEvent("storefront_viewed", { ...common, pathname: "/store" }),
    ).not.toBeNull();
  });

  it("accepts only approved event schemas", () => {
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
      $geoip_disable: true,
      pathname: `/store/${productId}`,
      product_id: productId,
    });
  });

  it("fails closed on invalid common fields or identifiers", () => {
    expect(
      sanitizeMeasurementEvent("checkout_started", {
        ...common,
        environment: "preview",
        pathname: "/checkout",
      }),
    ).toBeNull();
    expect(
      sanitizeMeasurementEvent("checkout_started", {
        ...common,
        environment: "production",
        pathname: "/checkout",
        $geoip_disable: false,
      })?.properties,
    ).toMatchObject({ environment: "production", $geoip_disable: true });
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

it("rejects payment permits in attribution and referrer host labels", () => {
  const permit = "ba6ce9ab-4aa2-40aa-8514-d5ecd17392f3";
  expect(safeSlug(permit)).toBeNull();
  expect(safeReferrerHost(permit + ".example.org")).toBeNull();
  expect(
    sanitizeMeasurementEvent("checkout_started", {
      storefront: "sole",
      environment: "staging",
      schema_version: 2,
      pathname: "/checkout",
      session_source: permit,
      discovery_campaign: permit,
      referrer_host: permit + ".example.org",
    })?.properties,
  ).toEqual({
    storefront: "sole",
    environment: "staging",
    schema_version: 2,
    pathname: "/checkout",
    $geoip_disable: true,
  });
});
