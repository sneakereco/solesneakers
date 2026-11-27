import { makeAudienceFixture } from "./audience-fixture";
import { parseReportRequest } from "../../../Source/Features/ReportContract/filters";
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
  expect(r.data?.products?.totalCount).toBe(1);
  expect(r.data?.variants?.rows[0]).toMatchObject({
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
  expect(r.data?.inventory?.availableUnits).toBe(9);
  expect(r.data?.comparison?.products?.totalCount).toBe(0);
  expect(r.data?.comparison).not.toHaveProperty("inventory");
});
it("shows observed variant demand without a purchase or an estimated price", async () => {
  const f = makeAudienceFixture();
  f.event(1, "unavailable_size_requested");
  f.event(1, "variant_selected", 1);
  f.event(1, "product_added_to_cart", 2);
  f.event(1, "out_of_stock_viewed", 3);
  const r = await getReport({ ...request("products"), report: "products" }, f.deps);
  expect(r.data?.variants?.rows[0]).toMatchObject({
    productId: f.pid,
    variantId: f.vid,
    unavailableSizeRequests: 1,
    variantSelections: 1,
    successfulAdditions: 1,
    confirmedOrders: 0,
  });
  expect(r.data?.products?.rows[0]).toMatchObject({
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
  expect(r.data?.products?.rows.every((p) => p.confirmedOrders === 0)).toBe(true);
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
it("review: keeps observed views but converts only eligible sessions and timely orders", async () => {
  const f = makeAudienceFixture();
  const req = { ...request("products"), report: "products" as const };
  const { range } = parseReportRequest(
    new URLSearchParams("report=products&from=2026-06-10&to=2026-06-11"),
    f.deps.now,
  );
  f.event(1, "product_viewed", 120, f.sid(1), "2026-06-10T03:59:00.000Z");
  f.event(2, "product_viewed");
  f.event(3, "product_viewed");
  for (const [order, session, at] of [
    ["early", 2, "2026-06-10T13:00:00.000Z"],
    ["repeat", 2, "2026-06-10T14:00:00.000Z"],
    ["late", 3, "2026-06-11T13:00:00.000Z"],
  ] as const) {
    f.sale(order, "guest", at);
    f.link(order, session, at);
    f.put("line", order, { ...line, lineId: order, productId: f.pid }, { order, at });
  }
  const result = await getReport({ ...req, range }, f.deps);
  expect(result.data?.products?.rows[0]).toMatchObject({
    views: 3,
    confirmedOrders: 3,
    viewToPurchase: { numerator: 1, denominator: 2 },
  });
});
it("review: preserves ranked sales if signals fail, and signals if ranked sales fail", async () => {
  const f = makeAudienceFixture();
  f.sale("o", "guest");
  f.put("line", "l", { ...line, productId: f.pid });
  const req = { ...request("products"), report: "products" as const };
  for (const fail of [
    "sole_analytics_inventory_demand",
    "sole_analytics_products",
    "both",
  ]) {
    const r = await getReport(req, {
      ...f.deps,
      execute: (q) => {
        if (fail === "both" || q.endpoint === fail) throw Error("private error");
        return f.deps.execute(q);
      },
    });
    if (fail === "both") expect(r.data).toBeNull();
    else if (fail === "sole_analytics_inventory_demand") {
      expect(r.data?.products?.rows[0].confirmedOrders).toBe(1);
      expect(r.data?.inventory).toBeNull();
      expect(r.data?.unmetDemand).toBeNull();
    } else {
      expect(r.data?.products).toBeNull();
      expect(r.data?.unmetDemand?.searches).toBe(0);
    }
    expect(r.coverage.some((c) => c.code === "component-unavailable")).toBe(true);
  }
});
it("review: reports unassignable purchased orders and actual returns on every page", async () => {
  const f = makeAudienceFixture();
  f.sale("o", "guest");
  f.put("refund", "r", {
    refundId: "r",
    status: "completed",
    merchandiseCents: 500,
    unallocatedCents: 0,
  });
  f.put("refund_line", "detail", {
    refundId: "r",
    lineId: "missing",
    merchandiseCents: 500,
    quantity: 1,
  });
  const r = await getReport(
    { ...request("products", "page=2"), report: "products" },
    f.deps,
  );
  expect(r.state).toBe("ready");
  expect(r.coverage).toEqual(
    expect.arrayContaining(
      ["productOrders", "productReturns"].map((metric) =>
        expect.objectContaining({ metric, missingCount: 1 }),
      ),
    ),
  );
  expect(r.data?.products?.totalCount).toBe(0);
});
it("review: rejects null wire merchandise for a known purchased line", async () => {
  const f = makeAudienceFixture();
  f.sale("o", "guest");
  f.put("line", "l", { ...line, productId: f.pid });
  const r = await getReport(
    { ...request("products"), report: "products" },
    {
      ...f.deps,
      execute: async (q) => {
        const wire = await f.execute(q);
        if (q.endpoint === "sole_analytics_products")
          for (const row of wire.results) row[wire.columns.indexOf("net")] = null;
        return wire;
      },
    },
  );
  expect(r.data?.products).toBeNull();
  expect(r.coverage.some((c) => c.metric === "products")).toBe(true);
});
