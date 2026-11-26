import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  validateQueryFixtures,
  verifyFixtureCorrection,
} from "../../../../../../scripts/analytics-query-fixtures";

const money = (cents: number | null, complete = true) => ({
  cents,
  complete,
  missingCount: complete ? 0 : 1,
});
const golden = {
  grossMerchandise: money(4800000),
  discounts: money(480000),
  merchandiseRefunds: money(90000),
  netMerchandise: money(4230000),
  netShipping: money(172500),
  netTax: money(329700),
  totalCollected: money(4732200),
  confirmedOrders: 1,
  unallocatedRefunds: money(0),
  recordedProfit: money(3930000),
};
const unallocated = {
  ...golden,
  totalCollected: money(4722200),
  unallocatedRefunds: money(10000),
  netMerchandise: money(4230000, false),
  netShipping: money(172500, false),
  netTax: money(329700, false),
  merchandiseRefunds: money(90000, false),
  recordedProfit: money(3930000, false),
};
const corrected = {
  ...golden,
  totalCollected: money(4722200),
  merchandiseRefunds: money(100000),
  netMerchandise: money(4220000),
};
const refundOnly = {
  ...golden,
  confirmedOrders: 0,
  grossMerchandise: money(0),
  discounts: money(0),
  merchandiseRefunds: money(90000),
  netMerchandise: money(-90000),
  netShipping: money(-7500),
  netTax: money(-300),
  totalCollected: money(-97800),
};
const cases = [
  ["golden", golden],
  ["unallocated", unallocated],
  ["corrected", corrected],
  ["refund-only", refundOnly],
].map(([scenario, sales], index) => ({
  scenario,
  from: "2026-06-0" + (index + 1),
  to: "2026-06-0" + (index + 1),
  sales,
  payments: {},
  health: {},
}));
test("fixture declaration requires all four independent scenarios and exact money and coverage", () => {
  expect(validateQueryFixtures(cases)).toHaveLength(4);
  for (const index of [0, 1, 2, 3])
    expect(() => validateQueryFixtures(cases.filter((_, i) => i !== index))).toThrow();
  expect(() =>
    validateQueryFixtures(
      cases.map((row) =>
        row.scenario === "unallocated"
          ? { ...row, sales: { ...unallocated, netShipping: money(172500) } }
          : row,
      ),
    ),
  ).toThrow();
  expect(() =>
    validateQueryFixtures(
      cases.map((row) =>
        row.scenario === "corrected"
          ? { ...row, sales: { ...corrected, totalCollected: money(4712200) } }
          : row,
      ),
    ),
  ).toThrow();
  expect(() =>
    validateQueryFixtures(
      cases.map((row) =>
        row.scenario === "refund-only"
          ? { ...row, sales: { ...refundOnly, confirmedOrders: 1 } }
          : row,
      ),
    ),
  ).toThrow();
  expect(() =>
    validateQueryFixtures(
      cases.map((row) => ({ ...row, from: "2026-06-01", to: "2026-06-01" })),
    ),
  ).toThrow();
});
test("query CLI rejects a golden-only manifest before touching owner configuration", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sole-query-fixture-"));
  const file = path.join(dir, "fixture.json");
  try {
    writeFileSync(file, JSON.stringify(cases.slice(0, 1)));
    try {
      execFileSync(
        process.execPath,
        [
          "scripts/verify-posthog-analytics.mjs",
          "--mode",
          "queries",
          "--environment",
          "staging",
          "--fixture",
          file,
        ],
        { stdio: "pipe" },
      );
      throw Error("unexpected success");
    } catch (e) {
      expect(String((e as { stderr?: Buffer }).stderr)).toContain(
        '"category":"invalid-fixture"',
      );
    }
  } finally {
    rmSync(file);
    rmdirSync(dir);
  }
});
test("corrected-window evidence needs the same immutable completed refund before and after allocation and a complete snapshot", () => {
  const refundId = randomUUID(),
    orderId = randomUUID(),
    at = "2026-06-03T12:00:00.000001Z";
  const first = {
    datasetId: "sole-staging",
    orderId,
    buyerKey: null,
    factId: "refund:" + refundId,
    revision: 1,
    kind: "refund",
    currency: "USD",
    effectiveAt: at,
    recordedAt: at,
    payload: {
      refundId,
      status: "completed",
      totalCents: 10000,
      unallocatedCents: 10000,
      merchandiseCents: null,
      shippingCents: null,
      taxCents: null,
    },
  };
  const second = {
    ...first,
    revision: 2,
    payload: {
      ...first.payload,
      unallocatedCents: 0,
      merchandiseCents: 10000,
      shippingCents: 0,
      taxCents: 0,
    },
  };
  const check = (facts: unknown[], n = facts.length) =>
    verifyFixtureCorrection(
      {
        revisions: n,
        facts: 1,
        pending: 0,
        leased: 0,
        failed: 0,
        oldestOutstandingAt: null,
        publications: facts.map((fact) => ({ publicationId: randomUUID(), fact })),
      },
      "sole-staging",
      "2026-06-03T04:00:00.000Z",
      "2026-06-04T04:00:00.000Z",
    );
  expect(() => check([second, first])).not.toThrow();
  expect(() => check([second])).toThrow();
  expect(() => check([first, second], 3)).toThrow();
  expect(() =>
    check([first, { ...second, effectiveAt: "2026-06-03T12:00:00.000002Z" }]),
  ).toThrow();
  expect(() => check([first, { ...second, factId: "refund:" + randomUUID() }])).toThrow();
  expect(() => check([first, second, { ...first, revision: 3 }])).toThrow();
});
