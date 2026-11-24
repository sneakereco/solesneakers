import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";
import { inspectDatabase } from "./preflight.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HISTORICAL_THROUGH = "20260922120000";
const HISTORICAL_COUNT = 105;
const COMPATIBILITY_VERSION = "20261123120000";

function manifest() {
  const versions = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", "HEAD", "--", "supabase/migrations"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
    .trim()
    .split(/\r?\n/)
    .filter((file) => /\/\d{14}_.+\.sql$/.test(file))
    .map((file) => file.split("/").at(-1).slice(0, 14))
    .sort();
  if (
    new Set(versions).size !== versions.length ||
    !versions.includes(HISTORICAL_THROUGH) ||
    versions.filter((version) => version <= HISTORICAL_THROUGH).length !==
      HISTORICAL_COUNT
  ) {
    throw new Error("invalid_committed_migration_inventory");
  }
  return versions;
}

function connection(value) {
  if (!value) throw new Error("explicit_connection_url_required");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_connection_url");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  ) {
    throw new Error("invalid_connection_url");
  }
  return url.href;
}

async function recordedVersions(connectionString) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    application_name: "single-store-deployment-baseline-gate",
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL row_security = off");
    return (
      await client.query(
        "SELECT version::text FROM supabase_migrations.schema_migrations ORDER BY version",
      )
    ).rows.map((row) => row.version);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* No transaction after a failed connection. */
    }
    await client.end();
  }
}

function validatePrefix(known, recorded) {
  const blockers = [];
  if (
    recorded.some((version) => !/^\d{14}$/.test(version) || !known.includes(version)) ||
    new Set(recorded).size !== recorded.length
  ) {
    blockers.push("unknown_or_invalid_recorded_migration");
  }
  const required = known.filter((version) => version <= HISTORICAL_THROUGH);
  if (required.some((version) => !recorded.includes(version))) {
    blockers.push("historical_baseline_incomplete");
  }
  const through = recorded.filter((version) => known.includes(version)).at(-1);
  if (known.some((version) => version <= through && !recorded.includes(version))) {
    blockers.push("recorded_migration_prefix_gap");
  }
  return { blockers, through };
}

export async function checkMigrationBaseline({ connectionString } = {}) {
  const url = connection(connectionString);
  const known = manifest();
  const recorded = await recordedVersions(url);
  const { blockers, through } = validatePrefix(known, recorded);
  const report = {
    formatVersion: 1,
    mode: "read-only-deployment-gate",
    ready: false,
    historicalThrough: HISTORICAL_THROUGH,
    historicalCount: HISTORICAL_COUNT,
    baselineThrough: through ?? null,
    recordedCount: recorded.length,
    pendingCount: known.length - recorded.length,
    blockers,
    preflight: null,
    expansionPreflight: { status: "not_run", reason: "migration_prefix_blocked" },
  };
  if (blockers.length) return report;
  if (recorded.includes(COMPATIBILITY_VERSION)) {
    // Later ordinary releases need registry safety, not a permanent data gate.
    // This does not certify current ownership, canonical data or schema readiness.
    report.expansionPreflight = {
      status: "skipped",
      reason: "compatibility_expansion_already_recorded",
    };
    report.ready = true;
    return report;
  }
  // Pending expansion still requires its full data preconditions at the exact
  // recorded prefix. The migration retains its own transactional guard as well.
  report.preflight = await inspectDatabase({
    connectionString: url,
    baselineThrough: through,
  });
  report.expansionPreflight = {
    status: report.preflight.ready ? "passed" : "blocked",
    reason: "compatibility_expansion_unrecorded",
  };
  if (!report.preflight.ready) report.blockers.push("preflight_blocked");
  report.ready = report.blockers.length === 0;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error("invalid_arguments");
    const report = await checkMigrationBaseline({
      connectionString: process.env.SINGLE_STORE_DATABASE_URL,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ready ? 0 : 1;
  } catch (error) {
    const allowed = [
      "explicit_connection_url_required",
      "invalid_connection_url",
      "invalid_arguments",
      "invalid_committed_migration_inventory",
    ];
    process.stdout.write(
      `${JSON.stringify({
        ready: false,
        mode: "read-only-deployment-gate",
        error: allowed.includes(error.message) ? error.message : "baseline_gate_failed",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
