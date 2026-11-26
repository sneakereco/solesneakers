import { makeAudienceFixture } from "./audience-fixture";
import { request, line } from "./commerce-fixture";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { sanitizeMeasurementEvent } from "../../../Source/Features/VisitorMeasurement/contract";
it("keeps original purchased variants, recorded stock and only the matching brand in a mixed basket", async () => {
  const f = makeAudienceFixture();
  f.sale("order", "guest");
  const other = "33333333-3333-4333-8333-333333333333",
    brand = "44444444-4444-4444-8444-444444444444";
  f.put(
    "line",
    "one",
    {
      ...line,
      lineId: "one",
      productId: f.pid,
      variantId: f.vid,
      brandId: brand,
      brandLabel: "Known",
      productName: "Original",
      quantity: 1,
      merchandiseCents: 2000000,
    },
    { order: "order" },
  );
  f.put(
    "line",
    "two",
    {
      ...line,
      lineId: "two",
      productId: other,
      variantId: other,
      productName: "Other",
      merchandiseCents: 2320000,
    },
    { order: "order" },
  );
  f.put(
    "inventory",
    "stock",
    { productId: f.pid, variantId: f.vid, availableUnits: 0 },
    { order: null },
  );
  const r = await getReport(
    { ...request("products", "brandId=" + brand), report: "products" },
    f.deps,
  );
  expect(r.data?.products.totalCount).toBe(1);
  expect(r.data?.variants.rows[0]).toMatchObject({
    productId: f.pid,
    variantId: f.vid,
    name: "Original",
    units: 1,
    availableUnits: 0,
    netMerchandise: { cents: 2000000 },
  });
});
it("keeps current stock out of a historical comparison", async () => {
  const f = makeAudienceFixture();
  f.put(
    "inventory",
    "stock",
    { productId: f.pid, variantId: f.vid, availableUnits: 9 },
    { order: null },
  );
  const r = await getReport(
    { ...request("products", "compare=true"), report: "products" },
    f.deps,
  );
  expect(r.data?.inventory.availableUnits).toBe(9);
  expect(r.data?.comparison?.products.totalCount).toBe(0);
  expect(r.data?.comparison).not.toHaveProperty("inventory");
});
it("shows observed variant demand without a purchase or an estimated price", async () => {
  const f = makeAudienceFixture();
  f.event(1, "unavailable_size_requested");
  f.event(1, "variant_selected", 1);
  f.event(1, "product_added_to_cart", 2);
  f.event(1, "out_of_stock_viewed", 3);
  const r = await getReport({ ...request("products"), report: "products" }, f.deps);
  expect(r.data?.variants.rows[0]).toMatchObject({
    productId: f.pid,
    variantId: f.vid,
    unavailableSizeRequests: 1,
    variantSelections: 1,
    successfulAdditions: 1,
    confirmedOrders: 0,
  });
  expect(r.data?.products.rows[0]).toMatchObject({
    stockoutViews: 1,
    netMerchandise: { cents: 0 },
  });
});
it("reports only observed variant stock, independent of visitor segmentation", async () => {
  const f = makeAudienceFixture(),
    brand = "44444444-4444-4444-8444-444444444444",
    second = "55555555-5555-4555-8555-555555555555";
  f.sale("order", "guest");
  for (const [variant, stock] of [
    [f.vid, 7],
    [second, null],
  ] as const) {
    f.put(
      "line",
      variant,
      {
        ...line,
        lineId: variant,
        brandId: brand,
        productId: f.pid,
        variantId: variant,
        merchandiseCents: 2160000,
      },
      { order: "order" },
    );
    f.put(
      "inventory",
      variant,
      { productId: f.pid, variantId: variant, availableUnits: stock },
      { order: null },
    );
  }
  const req = {
    ...request(
      "products",
      "brandId=" + brand + "&device=tablet&source=email&channel=email&campaign=fall",
    ),
    report: "products" as const,
  };
  const r = await getReport(req, f.deps);
  expect(r.data?.inventory).toMatchObject({
    scope: "recorded-variants",
    recordedVariants: 2,
    missingStockVariants: 1,
    catalogVariants: null,
    availableUnits: null,
  });
  expect(r.data?.products.rows.every((p) => p.confirmedOrders === 0)).toBe(true);
  for (const filter of ["device", "source", "channel", "campaign"])
    expect(r.coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "inapplicable-filter",
          metric: "inventory",
          filter,
        }),
      ]),
    );
});
const pid = "613d7c8e-f8aa-447a-92ce-d18350732d13";
const vid = "c76f1ac9-a852-41ac-b0b1-23487ddd85d8";
const base = {
  pathname: "/store/" + pid,
  storefront: "sole",
  schema_version: 2,
  environment: "staging",
};
it("admits successful search totals and typed catalog concepts without visitor input", () => {
  const props = {
    ...base,
    result_count: 0,
    query: "private@example.com",
    concept_kind: "brand",
    concept_id: pid,
  };
  expect(
    sanitizeMeasurementEvent("catalog_search_results", props)?.properties,
  ).toMatchObject({ result_count: 0, concept_kind: "brand", concept_id: pid });
  expect(
    sanitizeMeasurementEvent("catalog_search_results", props)?.properties,
  ).not.toHaveProperty("query");
  expect(
    sanitizeMeasurementEvent("catalog_search_results", { ...props, result_count: -1 }),
  ).toBeNull();
  expect(
    sanitizeMeasurementEvent("catalog_search_results", {
      ...props,
      concept_id: "private@example.com",
    })?.properties,
  ).not.toHaveProperty("concept_id");
});
it.each(["variant_selected", "unavailable_size_requested", "out_of_stock_viewed"])(
  "scopes %s to the rendered product",
  (event) => {
    const props = {
      ...base,
      product_id: pid,
      ...(event === "out_of_stock_viewed" ? {} : { variant_id: vid }),
    };
    expect(sanitizeMeasurementEvent(event, props)?.event).toBe(event);
    expect(sanitizeMeasurementEvent(event, { ...props, pathname: "/store" })).toBeNull();
  },
);
