import { exportAnalyticsCsv } from "../../../Source/Features/Reporting/csv-export";
import { getReport } from "../../../Source/Features/Reporting/report-service";
import { makeAudienceFixture } from "./audience-fixture";
import { request } from "./commerce-fixture";
import {
  validateCompiledQuery,
  CSV_EXECUTION,
} from "../../../Source/Features/Reporting/query-contract";
import { compileProductQueries } from "../../../Source/Features/Reporting/queries/products";
import { checkRankedExport } from "../../../Source/Features/Reporting/csv-export";
import { scope } from "./commerce-fixture";

jest.mock("server-only", () => ({}), { virtual: true });
test("exports only explicit aggregate fields and guards text cells while preserving numeric cents", async () => {
  const f = makeAudienceFixture(),
    r = request("products", "pageSize=100");
  f.journey();
  const result = await getReport({ ...r, report: "products" }, f.deps);
  const row = result.data!.products!.rows[0];
  for (const prefix of ["=", "+", "-", "@", " \t="]) {
    Object.assign(row, {
      name: prefix + 'model "a",\nred',
      email: "private-fixture",
      session_id: "private-fixture",
    });
    Object.assign(row.netMerchandise, { cents: -123 });
    const { body, filename } = exportAnalyticsCsv(result, r);
    expect(filename).toMatch(/products.*2026-06-10.*\.csv$/);
    expect(body).toContain("'" + prefix + 'model ""a"",\nred');
    expect(body).not.toContain("private-fixture");
    expect(body).toContain("-123");
    expect(body).toContain("America/New_York");
  }
});
test("only a trusted matching aggregate export can execute an expanded ranked definition", () => {
  const req = { ...request("products"), page: 1, pageSize: 5000 };
  const q = compileProductQueries(req, scope, CSV_EXECUTION).queries.products;
  expect(q.limit).toBe(25000);
  expect(validateCompiledQuery(q)).toBeNull();
  expect(validateCompiledQuery(q, CSV_EXECUTION)).toEqual(q);
  for (const mutation of [
    { limit: 25001 },
    { offset: 1 },
    { endpoint: "sole_analytics_reconciliation" as const },
    { variables: { ...q.variables, page_end: "7000" } },
  ])
    expect(validateCompiledQuery({ ...q, ...mutation }, CSV_EXECUTION)).toBeNull();
});
test("a provider clamp or duplicate may not erase matching rows or entire axes", () => {
  const q = compileProductQueries(
    { ...request("products"), pageSize: 5000 },
    scope,
    CSV_EXECUTION,
  ).queries.products;
  const good = {
    columns: ["axis", "item", "total"],
    results: ["product", "variant", "brand", "category", "size"].map((axis) => [
      axis,
      null,
      0,
    ]),
    hasMore: false,
  };
  expect(() => checkRankedExport(q, good)).not.toThrow();
  const packed = good.results.flatMap(([axis]) =>
    Array.from({ length: 5000 }, (_, i) => [axis, "group-" + i, 5000]),
  );
  expect(() => checkRankedExport(q, { ...good, results: packed })).not.toThrow();
  expect(() => checkRankedExport(q, { ...good, results: packed.slice(0, -1) })).toThrow();
  expect(() =>
    checkRankedExport(q, {
      ...good,
      results: [["product", null, 2], ...good.results.slice(1)],
    }),
  ).toThrow();
  const sources = { ...q, endpoint: "sole_analytics_discovery" as const, limit: 20000 };
  const channels = ["source", "channel", "campaign", "placement"].flatMap((axis) =>
    Array.from({ length: 5000 }, (_, i) => [axis, "label-" + i, 5000]),
  );
  expect(() =>
    checkRankedExport(sources, {
      columns: ["axis", "label", "total"],
      results: channels,
      hasMore: false,
    }),
  ).not.toThrow();
  for (const raw of [
    { ...good, hasMore: true },
    { ...good, results: good.results.slice(1) },
    {
      ...good,
      results: [["product", "x", 2], ["product", "x", 2], ...good.results.slice(1)],
    },
  ])
    expect(() => checkRankedExport(q, raw)).toThrow();
});
test("declines a paged or incomplete axis in either period", async () => {
  const f = makeAudienceFixture(),
    r = request("acquisition", "compare=true&pageSize=100");
  const result = await getReport({ ...r, report: "acquisition" }, f.deps);
  result.data!.comparison!.discovery.channels.totalCount = 101;
  expect(() => exportAnalyticsCsv(result, r)).toThrow(/filter|range|scope/i);
});
test("retains null section status, coverage, and recorded inventory even for an empty period", async () => {
  const f = makeAudienceFixture(),
    r = request("products", "pageSize=100");
  const result = await getReport({ ...r, report: "products" }, f.deps);
  result.data!.products = null;
  const { body } = exportAnalyticsCsv(result, r);
  expect(body).toContain("inventory");
  expect(body).toContain("products");
  expect(body).toContain("unavailable");
  expect(body).toContain("ingestionAsOf");
});
