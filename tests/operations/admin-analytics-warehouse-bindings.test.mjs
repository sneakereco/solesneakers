import assert from "node:assert/strict";
import test from "node:test";
import { planProvisioning } from "../../scripts/provision-admin-analytics.mjs";

for (const environment of ["staging", "production"]) {
  test(`${environment} keeps PostgreSQL export names while binding saved queries to materialized PostHog tables`, () => {
    const { manifest } = planProvisioning({
      environment,
      at: "2026-11-27T18:00:00Z",
    });
    assert.equal(manifest.sources.finance.table, "analytics_financial_export");
    assert.equal(manifest.sources.purchases.table, "analytics_purchase_link_export");
    assert.equal(manifest.sources.behavior.table, "analytics_behavior_export");

    const tables = new Set();
    for (const definition of manifest.endpoints) {
      for (const match of definition.sql.matchAll(
        /\b(?:FROM|JOIN)\s+((?:postgres_)?analytics_(?:financial|purchase_link)_export)\b/gi,
      )) {
        tables.add(match[1]);
      }
      assert.doesNotMatch(
        definition.sql,
        /\banalytics_(?:financial|purchase_link)_export\./,
        `${definition.name} must not retain an unbound table qualifier`,
      );
    }
    assert.deepEqual([...tables].sort(), [
      "postgres_analytics_financial_export",
      "postgres_analytics_purchase_link_export",
    ]);
  });
}

test("preserves the optional behavior archive source", () => {
  const { manifest } = planProvisioning({
    environment: "staging",
    at: "2026-11-27T12:00:00Z",
    archiveCutoff: "2026-11-27T13:00:00Z",
  });
  assert.equal(manifest.sources.behavior.table, "analytics_behavior_export");
  assert.match(
    manifest.endpoints.map((definition) => definition.sql).join("\n"),
    /\bFROM analytics_behavior_export\b/,
  );
});
