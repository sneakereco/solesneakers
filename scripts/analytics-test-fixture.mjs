import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const name = "supabase_db_admin-analytics-sdd-8119061f";
const label = "admin-analytics-sdd-8119061f";
const database = "admin_analytics_sdd";

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

// Only bootstraps a never-created database. A partial failure remains available for inspection.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { sql } = ownedFixture();
  assert.equal(
    sql(
      "postgres",
      "select count(*) from pg_database where datname='admin_analytics_sdd'",
    ),
    "0",
    "Fixture database already exists. Refusing to replace or reset it.",
  );
  sql(
    "postgres",
    "create database admin_analytics_sdd owner supabase_admin template template0",
  );
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
    load(new URL(file, migrations));
  }
  console.log("Created isolated schema-only analytics fixture.");
}
