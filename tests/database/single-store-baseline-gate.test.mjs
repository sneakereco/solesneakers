import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, test } from "node:test";
import { connect, testUrl } from "./fixtures/single-store-expansion.mjs";

const target = testUrl(process.env.SINGLE_STORE_TEST_DATABASE_URL);
assert.equal(target.pathname, "/single_store_test_expansion_20261123");
const historicalVersions = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", "HEAD", "--", "supabase/migrations"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter((name) => /\/\d{14}_.+\.sql$/.test(name))
  .map((name) => name.split("/").at(-1).slice(0, 14))
  .filter((version) => version <= "20260922120000")
  .sort();
assert.equal(historicalVersions.length, 105);
let db;
let checkMigrationBaseline;
try {
  ({ checkMigrationBaseline } = await import(
    "../../scripts/single-store/check-migration-baseline.mjs"
  ));
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
before(async () => {
  db = await connect(target.href);
});
after(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("truncate supabase_migrations.schema_migrations");
  await db.query(
    "insert into supabase_migrations.schema_migrations(version) select unnest($1::text[])",
    [historicalVersions],
  );
});
const check = () => {
  assert.equal(
    typeof checkMigrationBaseline,
    "function",
    "Missing read-only deployment baseline gate",
  );
  return checkMigrationBaseline({ connectionString: target.href });
};

test("complete historical baseline allows a pending additive suffix", async () => {
  const report = await check();
  assert.equal(report.ready, true);
  assert.equal(report.baselineThrough, "20260922120000");
  assert.equal(report.preflight.transaction.readOnly, true);
});

test("missing historical retirement fails before pending migration application", async () => {
  await db.query(
    "delete from supabase_migrations.schema_migrations where version='20260919090000'",
  );
  const report = await check();
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes("historical_baseline_incomplete"));
  assert.equal(report.preflight, null);
});

test("old prefix and unknown recorded version fail closed", async () => {
  await db.query(
    "delete from supabase_migrations.schema_migrations where version>='20260918180000'",
  );
  assert.equal((await check()).ready, false);
  await db.query(
    "insert into supabase_migrations.schema_migrations(version) values ('20990101000000')",
  );
  const report = await check();
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes("unknown_or_invalid_recorded_migration"));
});

test("known new suffixes permit pending work and expanded redeploys, but a later prefix gap blocks", async () => {
  // A self-contained Git fixture gives the actual gate a future committed HEAD
  // manifest without touching the application's Git HEAD, index or working tree.
  const fixtureRoot = await mkdtemp(join(resolve(".superpowers"), "gate-manifest-test-"));
  assert.ok(resolve(fixtureRoot).startsWith(`${resolve(".superpowers")}\\`));
  const collisionIds = [];
  try {
    await mkdir(join(fixtureRoot, "scripts/single-store"), { recursive: true });
    await mkdir(join(fixtureRoot, "supabase/migrations"), { recursive: true });
    for (const file of [
      "preflight.mjs",
      "preflight.sql",
      "check-migration-baseline.mjs",
    ]) {
      await copyFile(
        join("scripts/single-store", file),
        join(fixtureRoot, "scripts/single-store", file),
      );
    }
    for (const version of [...historicalVersions, "20261123120000", "20261124120000"]) {
      await writeFile(
        join(fixtureRoot, "supabase/migrations", `${version}_fixture.sql`),
        "-- manifest fixture only\n",
      );
    }
    const git = (args) =>
      execFileSync("git", ["-C", fixtureRoot, ...args], { stdio: "pipe" });
    git(["init", "--quiet"]);
    git(["add", "supabase/migrations", "scripts"]);
    git([
      "-c",
      "user.name=SQL fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "isolated gate fixture manifest",
    ]);
    const { checkMigrationBaseline: futureCheck } = await import(
      pathToFileURL(
        join(fixtureRoot, "scripts/single-store/check-migration-baseline.mjs"),
      )
    );
    const pending = await futureCheck({ connectionString: target.href });
    assert.equal(pending.ready, true);
    assert.equal(pending.pendingCount, 2);
    const historicalRequired = async () => {
      await db.query(
        "delete from supabase_migrations.schema_migrations where version='20260919090000'",
      );
      try {
        const missing = await futureCheck({ connectionString: target.href });
        assert.equal(missing.ready, false);
        assert.ok(missing.blockers.includes("historical_baseline_incomplete"));
        assert.equal(missing.preflight, null);
        assert.equal(missing.expansionPreflight.status, "not_run");
      } finally {
        await db.query(
          "insert into supabase_migrations.schema_migrations(version) values ('20260919090000')",
        );
      }
    };
    collisionIds.push(
      (
        await db.query(
          "insert into public.tag_brands(canonical_label) values ('Final gate legacy collision') returning id",
        )
      ).rows[0].id,
    );
    collisionIds.push(
      (
        await db.query(
          "insert into public.tag_brands(tenant_id,canonical_label) select id,'FINAL GATE LEGACY COLLISION' from public.tenants returning id",
        )
      ).rows[0].id,
    );
    const blockedExpansion = await futureCheck({ connectionString: target.href });
    assert.equal(blockedExpansion.ready, false);
    assert.ok(
      blockedExpansion.preflight.blockers.some(
        (item) => item.code === "canonical_collision",
      ),
    );
    assert.deepEqual(blockedExpansion.expansionPreflight, {
      status: "blocked",
      reason: "compatibility_expansion_unrecorded",
    });
    await historicalRequired();
    await db.query(
      "insert into supabase_migrations.schema_migrations(version) values ('20261123120000')",
    );
    const expanded = await futureCheck({ connectionString: target.href });
    assert.equal(expanded.baselineThrough, "20261123120000");
    assert.equal(expanded.pendingCount, 1);
    await historicalRequired();
    await db.query(
      "insert into supabase_migrations.schema_migrations(version) values ('20261124120000')",
    );
    const redeploy = await futureCheck({ connectionString: target.href });
    assert.equal(redeploy.pendingCount, 0);
    await historicalRequired();
    assert.deepEqual(
      [expanded.ready, redeploy.ready],
      [true, true],
      "recorded expansion must permit pending suffix and app-only redeploy despite the identical legacy collision",
    );
    assert.equal(expanded.preflight, null);
    assert.deepEqual(expanded.expansionPreflight, {
      status: "skipped",
      reason: "compatibility_expansion_already_recorded",
    });
    assert.equal(redeploy.preflight, null);
    assert.deepEqual(redeploy.expansionPreflight, {
      status: "skipped",
      reason: "compatibility_expansion_already_recorded",
    });
    const cli = spawnSync(
      process.execPath,
      [join(fixtureRoot, "scripts/single-store/check-migration-baseline.mjs")],
      {
        env: { ...process.env, SINGLE_STORE_DATABASE_URL: target.href },
        encoding: "utf8",
      },
    );
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    const cliReport = JSON.parse(cli.stdout);
    assert.equal(cliReport.preflight, null);
    assert.equal(cliReport.expansionPreflight.status, "skipped");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.tag_brands where id=any($1::uuid[])",
          [collisionIds],
        )
      ).rows[0].n,
      2,
    );
    await db.query(
      "delete from supabase_migrations.schema_migrations where version='20261123120000'",
    );
    const gap = await futureCheck({ connectionString: target.href });
    assert.equal(gap.ready, false);
    assert.ok(gap.blockers.includes("recorded_migration_prefix_gap"));
  } finally {
    if (collisionIds.length)
      await db.query("delete from public.tag_brands where id=any($1::uuid[])", [
        collisionIds,
      ]);
    // The checked absolute child of .superpowers is the only recursive target.
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("complete registry still blocks owner/canonical conflicts without changing data", async () => {
  const before = (await db.query("select count(*)::int n from public.tenants")).rows[0].n;
  await db.query("insert into public.tenants(name) values ('Gate extra owner')");
  try {
    const report = await check();
    assert.equal(report.ready, false);
    assert.ok(report.blockers.includes("preflight_blocked"));
    assert.equal(
      (await db.query("select count(*)::int n from public.tenants")).rows[0].n,
      before + 1,
    );
  } finally {
    await db.query("delete from public.tenants where name='Gate extra owner'");
  }
});

test("canonical collision blocks the deployment gate even with exactly one owner", async () => {
  const global = (
    await db.query(
      "insert into public.tag_brands(canonical_label) values ('Gate fixture collision') returning id",
    )
  ).rows[0].id;
  const owned = (
    await db.query(
      "insert into public.tag_brands(tenant_id,canonical_label) select id,'GATE FIXTURE COLLISION' from public.tenants returning id",
    )
  ).rows[0].id;
  try {
    const report = await check();
    assert.equal(report.ready, false);
    assert.ok(
      report.preflight.blockers.some((item) => item.code === "canonical_collision"),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.tag_brands where id=any($1::uuid[])",
          [[global, owned]],
        )
      ).rows[0].n,
      2,
    );
  } finally {
    await db.query("delete from public.tag_brands where id=any($1::uuid[])", [
      [global, owned],
    ]);
  }
});

test("CLI refuses omitted/invalid connections without credential or raw error output", () => {
  for (const value of [
    "",
    "postgresql://private-user:private-password@127.0.0.1:1/private-db",
  ]) {
    const child = spawnSync(
      process.execPath,
      ["scripts/single-store/check-migration-baseline.mjs"],
      {
        env: { ...process.env, SINGLE_STORE_DATABASE_URL: value },
        encoding: "utf8",
      },
    );
    assert.equal(child.status, 1);
    assert.doesNotMatch(
      child.stdout + child.stderr,
      /private-user|private-password|private-db|ECONNREFUSED|stack|node_modules/,
    );
    assert.equal(JSON.parse(child.stdout).ready, false);
  }
});
