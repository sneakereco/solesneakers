import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const name = "supabase_db_admin-analytics-sdd-8119061f";
const label = "admin-analytics-sdd-8119061f";
const canonical = "admin_analytics_sdd";
const replay = "admin_analytics_sdd_replay_8119061f";
const replayMarker = label + ":bootstrap-replay";

export function fixtureDatabase(args) {
  if (!args.length) return canonical;
  assert.deepEqual(
    args,
    ["--replay"],
    "Use --replay only for the named isolated replay database",
  );
  return replay;
}
export function verifyFixtureTarget(fixture, database) {
  assert([canonical, replay].includes(database));
  const expected =
    database === replay ? "supabase_admin|" + replayMarker : "supabase_admin";
  const claim =
    database === replay ? "||'|'||coalesce(shobj_description(oid,'pg_database'),'')" : "";
  assert.equal(
    fixture.sql(
      "postgres",
      "select pg_get_userbyid(datdba)" +
        claim +
        " from pg_database where datname='" +
        database +
        "'",
    ),
    expected,
    "Unexpected fixture owner or marker",
  );
}

export function ownedFixture() {
  const inspect = JSON.parse(
    execFileSync(
      "docker",
      [
        "inspect",
        "--format",
        '{"id":"{{.Id}}","label":"{{index .Config.Labels "codex.task"}}","ports":{{json .NetworkSettings.Ports}}}',
        name,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.match(inspect.id, /^[a-f0-9]{64}$/);
  assert.equal(inspect.label, label);
  assert.deepEqual(inspect.ports["5432/tcp"], [
    { HostIp: "127.0.0.1", HostPort: "60279" },
  ]);
  const sql = (target, input) =>
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        inspect.id,
        "psql",
        "-XAtq",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "supabase_admin",
        "-d",
        target,
      ],
      { input, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ).trim();
  return { id: inspect.id, sql };
}

// PostgreSQL roles are cluster-wide. The existing canonical database already owns
// these NOLOGIN readers. Replay the original migration bytes, accounting for its
// two duplicate-role diagnostics and rejecting every other error.
function replayReportingMigration(fixture, file) {
  verifyFixtureTarget(fixture, replay);
  const roles = ["sole_analytics_production_reader", "sole_analytics_staging_reader"];
  const roleSql =
    "select rolname||':'||oid from pg_roles r where rolname in ('sole_analytics_production_reader','sole_analytics_staging_reader') and not (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls) and not exists(select from pg_auth_members m where m.member=r.oid) order by rolname";
  const before = fixture.sql(replay, roleSql).split("\n");
  assert.deepEqual(
    before.map((row) => row.split(":")[0]),
    roles,
    "Expected two existing confined cluster reader roles",
  );
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      fixture.id,
      "psql",
      "-XAtq",
      "--single-transaction",
      "-v",
      "ON_ERROR_ROLLBACK=on",
      "-v",
      "VERBOSITY=verbose",
      "-U",
      "supabase_admin",
      "-d",
      replay,
      "-f",
      "-",
    ],
    { input: readFileSync(file), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "Database replay process failed");
  const diagnostics = result.stderr.trim().split(/\r?\n/);
  const locations = diagnostics.filter((line) =>
    /^LOCATION:\s+CreateRole, user\.c:\d+$/.test(line),
  );
  assert.equal(locations.length, 2, "Expected two PostgreSQL CreateRole diagnostics");
  const errors = diagnostics
    .filter((line) => !locations.includes(line))
    .map((line) => line.replace(/^psql:<stdin>:\d+: /, ""))
    .sort();
  assert.deepEqual(
    errors,
    roles.map((role) => 'ERROR:  42710: role "' + role + '" already exists'),
    "Unexpected replay diagnostics",
  );
  assert.deepEqual(
    fixture.sql(replay, roleSql).split("\n"),
    before,
    "Reader identities changed",
  );
  console.log(
    "Replayed reporting migration with the two verified existing NOLOGIN cluster roles.",
  );
}

// Only bootstraps a never-created database. A partial failure remains available for inspection.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const database = fixtureDatabase(process.argv.slice(2));
  const fixture = ownedFixture();
  const { sql } = fixture;
  assert.equal(
    sql("postgres", "select count(*) from pg_database where datname='" + database + "'"),
    "0",
    "Fixture database already exists. Refusing to replace or reset it.",
  );
  sql(
    "postgres",
    "create database " + database + " owner supabase_admin template template0",
  );
  if (database === replay)
    sql("postgres", "comment on database " + database + " is '" + replayMarker + "'");
  verifyFixtureTarget(fixture, database);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  const load = (file) => sql(database, readFileSync(file, "utf8"));
  load(new URL("./fixtures/admin-analytics/baseline-schema.sql", import.meta.url));
  const files = readdirSync(migrations)
    .sort()
    .filter((file) =>
      /^(20260918180000|20260919090000|20261123120000|2026112512|2026112518|20261127)/.test(
        file,
      ),
    );
  for (const file of files) {
    if (file.startsWith("20261127030000"))
      load(
        new URL("./fixtures/admin-analytics/representative-acls.sql", import.meta.url),
      );
    const migration = new URL(file, migrations);
    if (
      database === replay &&
      file === "20261125180200_admin_analytics_reporting_views.sql"
    )
      replayReportingMigration(fixture, migration);
    else load(migration);
  }
  console.log("Created isolated schema-only analytics fixture", database);
}
