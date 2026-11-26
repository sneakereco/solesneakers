import { fixture, sale, line, refund, older, request, scope } from "./commerce-fixture";
import {
  compileFinancialQueries,
  mapSalesResult,
} from "../../../Source/Features/Reporting/queries/financial";
import type {
  SalesData,
  PaymentsData,
} from "../../../Source/Features/ReportContract/types";

test("golden period uses distinct original captures, current refunds and frozen snapshots", async () => {
  const f = fixture();
  f.put("order", "o", sale, { revision: 2 });
  f.put("order", "o", { ...sale, totalCollectedCents: 99 }, { revision: 1 });
  f.put("line", "l", line);
  f.put("refund", "r", refund);
  f.put("refund", "r", refund);
  f.put("refund", "pending", { ...refund, status: "pending" });
  f.put("order", "other", sale, { dataset: "sole-production" });
  const get = async () => (await f.report("sales", "compare=true")) as SalesData;
  const data = await get();
  expect(data.grossMerchandise.cents).toBe(4_800_000);
  expect(data.discounts.cents).toBe(480_000);
  expect(data.merchandiseRefunds.cents).toBe(90_000);
  expect(data.netMerchandise.cents).toBe(4_230_000);
  expect(data.netShipping.cents).toBe(172_500);
  expect(data.netTax.cents).toBe(329_700);
  expect(data.totalCollected).toEqual({
    cents: 4_732_200,
    complete: true,
    missingCount: 0,
  });
  expect(data.averageOrderValue.cents).toBe(4_320_000);
  expect(data.medianOrderValue.cents).toBe(4_320_000);
  expect(data.orderValueBins.reduce((n, b) => n + b.confirmedOrders, 0)).toBe(1);
  expect(data.confirmedOrders).toBe(1);
  expect(data.units).toBe(3);
  expect(data.series[0].netMerchandise.cents).toBe(4_230_000);
  expect(data.comparisonSeries?.[0].confirmedOrders).toBe(0);
  expect(data.fees.cents).toBeNull();
  expect(data.shippingContribution.complete).toBe(false);
  f.put("refund", "extra", {
    ...refund,
    refundId: "extra",
    totalCents: 10000,
    merchandiseCents: null,
    shippingCents: null,
    taxCents: null,
    unallocatedCents: 10000,
  });
  const incomplete = await get();
  expect(incomplete.totalCollected.cents).toBe(4_722_200);
  expect(incomplete.unallocatedRefunds.cents).toBe(10000);
  expect(incomplete.netMerchandise.complete).toBe(false);
  expect(incomplete.recordedProfit.complete).toBe(false);
  f.put(
    "refund",
    "extra",
    {
      ...refund,
      refundId: "extra",
      totalCents: 10000,
      merchandiseCents: 10000,
      shippingCents: 0,
      taxCents: 0,
      unallocatedCents: 0,
    },
    { revision: 2 },
  );
  expect((await get()).totalCollected.cents).toBe(4_722_200);
  expect((await get()).netMerchandise).toEqual({
    cents: 4_220_000,
    complete: true,
    missingCount: 0,
  });
});
test("refund-only period uses actual return/restock facts and original line cost", async () => {
  const f = fixture();
  f.put("order", "o", sale, { at: older });
  f.put("line", "l", line, { at: older });
  f.put("refund", "r", refund);
  f.put("refund_line", "rl", {
    refundId: "r",
    lineId: "l",
    merchandiseCents: 90000,
    quantity: 1,
    restockedQuantity: 0,
  });
  const get = async (extra = "") => (await f.report("sales", extra)) as SalesData;
  const day = await get();
  expect(day.confirmedOrders).toBe(0);
  expect(day.totalCollected.cents).toBe(-97800);
  expect(day.netUnits).toBe(-1);
  expect(day.recordedProfit.cents).toBe(-90000);
  expect(day.averageOrderValue.cents).toBeNull();
  expect((await get("dateBasis=order-cohort")).totalCollected.cents).toBe(0);
  f.put(
    "refund_line",
    "rl",
    {
      refundId: "r",
      lineId: "l",
      merchandiseCents: 90000,
      quantity: 1,
      restockedQuantity: 1,
    },
    { revision: 2 },
  );
  expect((await get()).recordedCogs.cents).toBe(-100000);
  expect((await get()).recordedProfit.cents).toBe(10000);
});
test("unreconciled 1800 capture keeps its verified amount; zero cost and missing buyer stay distinct", async () => {
  const f = fixture();
  f.put(
    "order",
    "o",
    {
      ...sale,
      grossMerchandiseCents: 2000,
      discountCents: 0,
      merchandiseCents: 2000,
      taxCents: null,
      shippingCents: 0,
      totalCollectedCents: 1800,
    },
    { buyer: null },
  );
  f.put("line", "l", { ...line, merchandiseCents: 2000, unitCostCents: 0 });
  const s = (await f.report("sales")) as SalesData;
  expect(s.totalCollected.cents).toBe(1800);
  expect(s.netMerchandise.complete).toBe(false);
  expect(s.recordedProfit.complete).toBe(false);
  expect(s.taxCollected.cents).toBeNull();
  expect(s.buyers).toEqual({ known: 0, missingOrders: 1 });
  expect(s.recordedCogs.cents).toBe(0);
  f.put("line", "l", { ...line, unitCostCents: null }, { revision: 2 });
  expect(((await f.report("sales")) as SalesData).recordedCogs.cents).toBeNull();
});
test("untracked orders included by default; only newest consented purchase link establishes segment", async () => {
  const f = fixture();
  f.put("order", "o", sale);
  f.link(1, older);
  expect(
    ((await f.report("sales", "device=mobile&source=search")) as SalesData)
      .confirmedOrders,
  ).toBe(1);
  f.link(0, "2026-07-01T00:00:00.000Z");
  expect(((await f.report("sales", "device=mobile")) as SalesData).confirmedOrders).toBe(
    0,
  );
  expect(((await f.report("sales")) as SalesData).confirmedOrders).toBe(1);
});
test("method counts use positive orders and payment-stage resolutions; credits keep adjustment date", async () => {
  const f = fixture();
  f.put("order", "o", sale);
  f.put(
    "order",
    "z",
    { ...sale, totalCollectedCents: 0, paymentMethod: null },
    { order: "z" },
  );
  const p = {
    stage: "payment",
    method: "card",
    outcome: "succeeded",
    reason: "none",
    resolvedAt: "2026-06-10T11:00:00.000Z",
  };
  f.put("payment_attempt", "a", p, { at: older });
  f.put("payment_attempt", "b", { ...p, outcome: "failed" }, { order: null });
  f.put(
    "payment_attempt",
    "c",
    { ...p, outcome: "unknown", resolvedAt: null },
    { order: null },
  );
  f.put("payment_attempt", "d", { ...p, stage: "reservation" });
  f.put("fee", "fee", { adjustment: "charge", amountCents: 30 });
  f.put("fee", "credit", { adjustment: "credit", amountCents: 5 });
  const result = (await f.report("payments")) as PaymentsData;
  expect(result.paidOrders).toBe(1);
  expect(result.resolvedAttempts).toBe(2);
  expect(result.pendingAttempts).toBe(1);
  expect(result.methods.rows[0]).toMatchObject({
    method: "card",
    paidOrders: 1,
    successfulAttempts: 1,
    failedAttempts: 1,
    fees: { cents: 25 },
    successRate: { value: 0.5 },
  });
});
test("compilation refuses untrusted history and malformed/unsafe provider results", async () => {
  expect(() =>
    compileFinancialQueries(request("sales"), { ...scope, financialSource: "events" }),
  ).toThrow();
  const f = fixture();
  f.put("order", "o", sale);
  const compiled = compileFinancialQueries(request("sales"), scope);
  const summary = await f.execute(compiled.queries.summary);
  const series = await f.execute(compiled.queries.series);
  expect(
    mapSalesResult({
      request: request("sales"),
      activatedAt: scope.activatedAt,
      summary,
      series,
    }).confirmedOrders,
  ).toBe(1);
  expect(() =>
    mapSalesResult({
      request: request("sales"),
      summary: { ...summary, hasMore: true },
      series,
      activatedAt: scope.activatedAt,
    }),
  ).toThrow();
  for (const bad of ["9007199254740992", Infinity, 1.2, 7, "1e9"]) {
    const copy = structuredClone(summary);
    copy.results[0][copy.columns.indexOf("gross")] = bad;
    expect(() =>
      mapSalesResult({
        request: request("sales"),
        summary: copy,
        series,
        activatedAt: scope.activatedAt,
      }),
    ).toThrow();
  }
});
test("derived order values round half cents up and retain their exact denominator", async () => {
  const f = fixture();
  for (const [i, value] of [100, 101].entries())
    f.put(
      "order",
      String(i),
      {
        ...sale,
        grossMerchandiseCents: value,
        discountCents: 0,
        merchandiseCents: value,
        shippingCents: 0,
        taxCents: 0,
        totalCollectedCents: value,
      },
      { order: String(i) },
    );
  const s = (await f.report("sales")) as SalesData;
  expect(s.averageOrderValue.cents).toBe(101);
  expect(s.medianOrderValue.cents).toBe(101);
  expect(s.confirmedOrders).toBe(2);
  expect(s.netMerchandise.cents).toBe(201);
  const p = (await f.report("payments")) as PaymentsData;
  expect(p.methods.rows[0].averageOrderValue.cents).toBe(101);
});
test("omitted or conflicting money basis does not invent a negative profit from the original line cost", async () => {
  const f = fixture();
  f.put("order", "o", { ...sale, totalCollectedCents: 1800, taxCents: null });
  f.put("line", "l", line);
  const s = (await f.report("sales")) as SalesData;
  expect(s.recordedProfit.cents).toBeNull();
  expect(s.units).toBeNull();
  expect(s.costCoverage.lines.numerator).toBe(0);
});
test("original-order fee/label flow uses actual adjustment dates; zero costs are known", async () => {
  const f = fixture();
  f.put("order", "o", sale);
  f.put("line", "l", { ...line, unitCostCents: 0 });
  f.put("fee", "zero", { adjustment: "charge", amountCents: 0 });
  f.put("shipping_cost", "label", { adjustment: "charge", amountCents: 1000 });
  f.put("shipping_cost", "credit", { adjustment: "credit", amountCents: 50 });
  const s = (await f.report("sales")) as SalesData;
  expect(s.recordedCogs).toEqual({ cents: 0, complete: true, missingCount: 0 });
  expect(s.fees.complete).toBe(true);
  expect(s.shippingContribution.cents).toBe(179050);
});
test("purchase filters select whole orders from the same frozen matching line", async () => {
  const f = fixture();
  const productId = "11111111-1111-4111-8111-111111111111",
    brandId = "22222222-2222-4222-8222-222222222222";
  f.put("order", "o", sale);
  f.put("line", "l", { ...line, productId, brandId: null });
  f.put("line", "other", { ...line, lineId: "other", productId: "other", brandId });
  expect(
    ((await f.report("sales", "productId=" + productId)) as SalesData).totalCollected
      .cents,
  ).toBe(4830000);
  expect(
    (
      (await f.report(
        "sales",
        "productId=" + productId + "&brandId=" + brandId,
      )) as SalesData
    ).confirmedOrders,
  ).toBe(0);
});
test("empty comparison and filtered payments retain actual coverage denominators", async () => {
  const f = fixture();
  f.put("order", "o", sale);
  const p = (await f.report("payments", "device=mobile&compare=true")) as PaymentsData;
  expect(p.attribution).toEqual({ eligibleOrders: 1, attributedOrders: 0 });
  expect(p.comparison?.paidOrders).toBe(0);
  const s = (await f.report("sales", "compare=true")) as SalesData;
  expect(s.comparison?.confirmedOrders).toBe(0);
  expect(s.comparison?.averageOrderValue.cents).toBeNull();
});
test("a zero-balance completion with no instrument is excluded from an explicit unknown-method scope", async () => {
  const f = fixture();
  f.put("order", "o", { ...sale, totalCollectedCents: 0, paymentMethod: null });
  expect(
    ((await f.report("sales", "paymentMethod=unknown")) as SalesData).confirmedOrders,
  ).toBe(0);
});
test("a bucket before activation is unavailable; the preceding equal calendar range remains independently dated", async () => {
  const f = fixture();
  f.put("order", "o", sale);
  const r = request("sales", "compare=true");
  const dataset = { ...scope, activatedAt: "2026-06-10T11:00:00.000Z" };
  const { executeCommerceReport } = await import(
    "../../../Source/Features/Reporting/report-service"
  );
  const s = (await executeCommerceReport(r, dataset, (q) => f.execute(q))) as SalesData;
  expect(s.comparisonSeries?.[0].confirmedOrders).toBeNull();
  expect(s.comparisonSeries?.[0].netMerchandise.cents).toBeNull();
  expect(s.series[0].confirmedOrders).toBe(1);
});
test.each(["week", "month"])(
  "clipped %s SQL and mapper buckets share the Eastern calendar",
  async (bucket) => {
    const f = fixture();
    f.put("order", "o", sale);
    const s = (await f.report("sales", "bucket=" + bucket)) as SalesData;
    expect(s.series).toHaveLength(1);
    expect(s.series[0]).toMatchObject({
      startInclusive: "2026-06-10T04:00:00.000Z",
      endExclusive: "2026-06-11T04:00:00.000Z",
      confirmedOrders: 1,
    });
  },
);
test("partially observed original merchandise lines keep their known COGS subtotal with missing coverage", async () => {
  const f = fixture();
  f.put("order", "o", {
    ...sale,
    grossMerchandiseCents: 10000,
    discountCents: 0,
    merchandiseCents: 10000,
    shippingCents: 0,
    taxCents: 0,
    totalCollectedCents: 10000,
  });
  f.put("line", "l", {
    ...line,
    quantity: 1,
    merchandiseCents: 6000,
    unitCostCents: 2000,
  });
  expect(((await f.report("sales")) as SalesData).recordedCogs).toEqual({
    cents: 2000,
    complete: false,
    missingCount: 1,
  });
  f.put(
    "line",
    "l",
    { ...line, quantity: 1, merchandiseCents: 10000, unitCostCents: 2000 },
    { revision: 2 },
  );
  f.put(
    "order",
    "o",
    {
      ...sale,
      grossMerchandiseCents: 10000,
      discountCents: 0,
      merchandiseCents: 10000,
      shippingCents: 0,
      taxCents: null,
      totalCollectedCents: 9000,
    },
    { revision: 2 },
  );
  const corrected = (await f.report("sales")) as SalesData;
  expect(corrected.recordedCogs).toEqual({
    cents: 2000,
    complete: true,
    missingCount: 0,
  });
  expect(corrected.recordedProfit.complete).toBe(false);
});
test.each([
  [1, "bin_5", "0"],
  [1, "middle_count", "0"],
  [2, "middle_count", "1"],
  [0, "middle_count", "1"],
])(
  "rejects inconsistent order-value population %s column %s",
  async (population, key, bad) => {
    const f = fixture();
    for (let i = 0; i < Number(population); i++)
      f.put("order", String(i), sale, { order: String(i) });
    const r = request("sales"),
      { queries } = compileFinancialQueries(r, scope);
    const summary = await f.execute(queries.summary),
      series = await f.execute(queries.series);
    const raw = { request: r, activatedAt: scope.activatedAt, summary, series };
    expect(mapSalesResult(raw).confirmedOrders).toBe(population);
    summary.results[0][summary.columns.indexOf(String(key))] = bad;
    expect(() => mapSalesResult(raw)).toThrow();
  },
);
