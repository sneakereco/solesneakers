import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("admin analytics migrations append to the deployed migration prefix", () => {
  const migrations = execFileSync(
    "git",
    ["ls-files", "-z", "--", "supabase/migrations/*.sql"],
    { cwd: new URL("../../", import.meta.url), encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .map((path) => {
      const [, version, name] = /\/(\d{14})_(.+)\.sql$/.exec(path);
      return { version, name };
    })
    .sort((left, right) => left.version.localeCompare(right.version));

  const historical = migrations
    .filter(({ version }) => version <= "20260922120000")
    .map(({ version }) => version);
  assert.equal(historical.length, 105);

  // Both live environments had this recorded suffix when analytics first merged.
  const recorded = [
    ...historical,
    "20261123120000",
    "20261125120000",
    "20261125121000",
    "20261125122000",
    "20261125123000",
    "20261125124000",
    "20261127010000",
    "20261127020000",
  ];
  const recordedVersions = new Set(recorded);
  const pending = migrations.filter(({ version }) => !recordedVersions.has(version));
  assert.deepEqual(
    pending.filter(({ version }) => version <= recorded.at(-1)),
    [],
    "Pending migrations sort inside the deployed prefix",
  );
  assert.deepEqual(
    migrations.slice(0, recorded.length).map(({ version }) => version),
    recorded,
  );
  assert.deepEqual(
    pending.slice(0, 9).map(({ name }) => name),
    [
      "admin_analytics_fact_ledger",
      "admin_analytics_source_hooks",
      "admin_analytics_reporting_views",
      "admin_analytics_behavior_observations",
      "private_cost_reads",
      "activate_analytics_dataset",
      "analytics_observation_refresh",
      "native_retention_gate",
      "admin_analytics_launch_corrections",
    ],
  );
});
