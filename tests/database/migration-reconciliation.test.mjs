import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as gate from "../../scripts/single-store/check-migration-baseline.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bootstrap = "20261127134000";
const checkout = [
  "20261127040000",
  "20261127041000",
  "20261127042000",
  "20261127043000",
  "20261127044000",
  "20261127045000",
  "20261127046000",
  "20261127047000",
];
const connectionString =
  "postgresql://reader:private-password@database.example.com:5432/postgres?sslmode=require";
const row = (entry) => ({
  version: entry.version,
  name: entry.path.slice(entry.path.lastIndexOf("/") + 16, -4),
  statements: [entry.sql],
});
function setup() {
  const inventory = gate.readMigrationInventory(root);
  const baseline = inventory.entries
    .filter(({ version }) => version <= "20261127034000")
    .map(row);
  const boot = row(inventory.entries.find(({ version }) => version === bootstrap));
  const plan = (recordedRows, otherInventory = inventory, url = connectionString) =>
    gate.planMigrationBaseline({
      inventory: otherInventory,
      recordedRows,
      connectionString: url,
    });
  return { inventory, baseline, boot, plan };
}

test("production-shaped registry produces the exact reviewed backfill plan", () => {
  assert.equal(
    typeof gate.readMigrationInventory,
    "function",
    "Missing committed and disk migration inventory verification",
  );
  assert.equal(
    typeof gate.planMigrationBaseline,
    "function",
    "Missing reviewed migration reconciliation planner",
  );
  const { inventory, baseline, boot, plan } = setup();
  assert.equal(baseline.length, 122);
  const result = plan([...baseline, boot]);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.migrationPlan.includeAll, true);
  assert.deepEqual(
    result.migrationPlan.pendingFiles,
    inventory.entries
      .filter(({ version }) => checkout.includes(version))
      .map(({ path }) => path),
  );
  assert.equal(result.migrationPlan.pendingFiles.length, 8);
  for (const field of ["inventoryDigest", "recordedDigest", "databaseFingerprint"])
    assert.match(result.migrationPlan[field], /^[a-f0-9]{64}$/);
  assert.match(result.migrationPlan.head, /^[a-f0-9]{40}$/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-password|reader|database\.example/,
  );
});

test("every sequential partial retry permits only the remaining reviewed suffix", () => {
  const { inventory, baseline, boot, plan } = setup();
  for (let count = 0; count <= 8; count++) {
    const applied = inventory.entries
      .filter(({ version }) => checkout.slice(0, count).includes(version))
      .map(row);
    const result = plan([...baseline, ...applied, boot]);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.migrationPlan.includeAll, count < 8);
    assert.equal(result.migrationPlan.pendingFiles.length, 8 - count);
  }
});

test("unknown, duplicate, historical, analytics, and nonsequential checkout gaps remain blocked", () => {
  const { inventory, baseline, boot, plan } = setup();
  const cases = [
    [
      ...baseline,
      boot,
      { version: "20990101000000", name: "unexpected", statements: [] },
    ],
    [...baseline, boot, boot],
    [...baseline.filter(({ version }) => version !== "20260919090000"), boot],
    [...baseline.filter(({ version }) => version !== "20261127033000"), boot],
    [
      ...baseline,
      row(inventory.entries.find(({ version }) => version === checkout[1])),
      boot,
    ],
  ];
  for (const recorded of cases) {
    const result = plan(recorded);
    assert.ok(result.blockers.length);
    assert.equal(result.migrationPlan.includeAll, false);
  }
  const extraInventory = {
    ...inventory,
    entries: [
      ...inventory.entries,
      {
        version: "20261127035000",
        path: "supabase/migrations/20261127035000_unreviewed.sql",
        blob: "0".repeat(40),
        sql: "select 1;",
      },
    ].sort((a, b) => a.version.localeCompare(b.version)),
  };
  assert.ok(
    plan([...baseline, boot], extraInventory).blockers.includes(
      "recorded_migration_prefix_gap",
    ),
  );
});

test("changed approved checkout or bootstrap blobs cannot use the reconciliation exception", () => {
  const { inventory, baseline, boot, plan } = setup();
  for (const version of [...checkout, bootstrap]) {
    const changed = {
      ...inventory,
      entries: inventory.entries.map((entry) =>
        entry.version === version ? { ...entry, blob: "0".repeat(40) } : entry,
      ),
    };
    assert.ok(plan([...baseline, boot], changed).blockers.length);
  }
});

test("reviewed checkout gaps cannot conceal a separate gap after the bootstrap", () => {
  const { inventory, baseline, boot, plan } = setup();
  const later = ["20261127140000", "20261127150000"].map((version) => ({
    version,
    path: `supabase/migrations/${version}_future.sql`,
    blob: "0".repeat(40),
    sql: "select 1;",
  }));
  const extended = { ...inventory, entries: [...inventory.entries, ...later] };
  const result = plan([...baseline, boot, row(later[1])], extended);
  assert.ok(result.blockers.includes("recorded_migration_prefix_gap"));
  assert.equal(result.migrationPlan.includeAll, false);
});

test("recorded bootstrap must have the exact name and substantive SQL", () => {
  const { baseline, boot, plan } = setup();
  for (const changed of [
    { ...boot, name: "unexpected_bootstrap" },
    { ...boot, statements: [] },
    { ...boot, statements: [boot.statements[0] + " select 'unreviewed';"] },
    {
      ...boot,
      statements: [
        boot.statements[0].replace("__schema_bootstrap__", "forged_schema_bootstrap"),
      ],
    },
  ])
    assert.ok(
      plan([...baseline, changed]).blockers.includes("recorded_bootstrap_mismatch"),
    );
  const commented = boot.statements[0].replace(
    "create table",
    "CrEaTe /* outer /* nested */ comment */ TABLE",
  );
  assert.deepEqual(
    plan([...baseline, { ...boot, statements: [commented] }]).blockers,
    [],
  );
  // The registry stores distinct SQL statements without their separating semicolons.
  const separated = boot.statements[0].split(/;\n(?=alter table|revoke all|insert into)/);
  assert.ok(separated.length > 1);
  assert.deepEqual(plan([...baseline, { ...boot, statements: separated }]).blockers, []);
});

test("SQL splitting preserves quoted semicolons, comments, and dollar-quoted bodies", async () => {
  const { canonicalSqlStatements } = await import(
    "../../scripts/single-store/migration-reconciliation.mjs"
  );
  const source =
    "begin; -- ignored ;\n select 'a;--b', E'escaped\\\';still', \"semi;name\"; /* nest /* ; */ */ do $body$ begin perform 'x;'; end $body$; commit;";
  const result = canonicalSqlStatements(source);
  assert.equal(result.length, 2);
  assert.notDeepEqual(
    canonicalSqlStatements("select 'a b';"),
    canonicalSqlStatements("select 'ab';"),
  );
  assert.notDeepEqual(
    canonicalSqlStatements("select a b;"),
    canonicalSqlStatements("select ab;"),
  );
  assert.throws(() => canonicalSqlStatements("select 'unfinished"));
  assert.throws(() => canonicalSqlStatements("do $$ unfinished;"));
});

test("plan digests bind registry contents and database identity without binding passwords", () => {
  const { baseline, boot, plan } = setup();
  const original = plan([...baseline, boot]).migrationPlan;
  assert.equal(
    plan(
      [...baseline, boot],
      undefined,
      connectionString.replace("private-password", "rotated-password"),
    ).migrationPlan.databaseFingerprint,
    original.databaseFingerprint,
  );
  assert.notEqual(
    plan(
      [...baseline, boot],
      undefined,
      connectionString.replace("database.example.com", "other.example.com"),
    ).migrationPlan.databaseFingerprint,
    original.databaseFingerprint,
  );
  assert.notEqual(
    plan([...baseline.slice(1), { ...baseline[0], name: "changed" }, boot]).migrationPlan
      .recordedDigest,
    original.recordedDigest,
  );
  assert.equal(
    plan([boot, ...baseline].reverse()).migrationPlan.recordedDigest,
    original.recordedDigest,
  );
});

test("strict ordinary prefixes and completed registry retain their original behavior", () => {
  const { inventory, baseline, plan } = setup();
  const known = inventory.entries.map(({ version }) => version);
  assert.deepEqual(
    gate.validatePrefix(
      known,
      baseline.map(({ version }) => version),
    ),
    { blockers: [], through: "20261127034000" },
  );
  const ordinary = plan(baseline);
  assert.deepEqual(ordinary.blockers, []);
  assert.equal(ordinary.migrationPlan.includeAll, false);
  assert.equal(ordinary.migrationPlan.pendingFiles.length, 9);
  const complete = plan(inventory.entries.map(row));
  assert.deepEqual(complete.blockers, []);
  assert.deepEqual(complete.migrationPlan.pendingFiles, []);
  assert.equal(complete.migrationPlan.includeAll, false);
});

test("disk inventory rejects modified, deleted, renamed, ignored, and nested extra SQL", () => {
  const directory = mkdtempSync(join(tmpdir(), "migration-inventory-"));
  const migrations = join(directory, "supabase", "migrations");
  const file = join(migrations, "20260922120000_fixture.sql");
  const git = (args) =>
    execFileSync("git", ["-C", directory, ...args], { stdio: "pipe" });
  try {
    mkdirSync(migrations, { recursive: true });
    writeFileSync(file, "select 1;\n");
    writeFileSync(join(directory, ".gitignore"), "*ignored.sql\n");
    writeFileSync(join(directory, ".gitattributes"), "* text=auto\n");
    git(["init", "--quiet"]);
    git(["config", "core.autocrlf", "true"]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "inventory fixture",
    ]);
    const original = gate.readMigrationInventory(directory);
    assert.equal(original.entries.length, 1);
    writeFileSync(file, "select 1;\r\n");
    const crlf = gate.readMigrationInventory(directory);
    assert.equal(crlf.inventoryDigest, original.inventoryDigest);
    assert.equal(crlf.entries[0].sql, "select 1;\n");
    writeFileSync(file, "select 2;\n");
    assert.throws(
      () => gate.readMigrationInventory(directory),
      /migration_inventory_drift/,
    );
    writeFileSync(file, "select 1;\n");
    const renamed = join(migrations, "20260922120000_renamed.sql");
    renameSync(file, renamed);
    assert.throws(
      () => gate.readMigrationInventory(directory),
      /migration_inventory_drift/,
    );
    renameSync(renamed, file);
    rmSync(file);
    assert.throws(
      () => gate.readMigrationInventory(directory),
      /migration_inventory_drift/,
    );
    writeFileSync(file, "select 1;\n");
    for (const extra of [
      join(migrations, "20990101000000_ignored.sql"),
      join(migrations, "nested", "20990101000000_extra.sql"),
    ]) {
      mkdirSync(join(extra, ".."), { recursive: true });
      writeFileSync(extra, "select 99;\n");
      assert.throws(
        () => gate.readMigrationInventory(directory),
        /migration_inventory_drift/,
      );
      rmSync(extra);
    }
    assert.equal(
      gate.readMigrationInventory(directory).inventoryDigest,
      original.inventoryDigest,
    );
  } finally {
    // mkdtemp allocated this exact child; no application paths are removed.
    assert.ok(directory.startsWith(join(tmpdir(), "migration-inventory-")));
    rmSync(directory, { recursive: true, force: true });
  }
});
