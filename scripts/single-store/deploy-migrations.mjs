import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { checkMigrationBaseline } from "./check-migration-baseline.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI = fileURLToPath(
  new URL("../../node_modules/supabase/dist/supabase.js", import.meta.url),
);
const CLI_VERSION = "2.117.0";
const exec = promisify(execFile);

async function runLockedCli(args) {
  try {
    const { stdout } = await exec(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return stdout;
  } catch {
    // CLI failures can contain connection strings or migration SQL. Emit only
    // this code; the database history and checked plan support safe retries.
    throw new Error("migration_cli_failed");
  }
}

function requirePlan(report) {
  const plan = report?.migrationPlan;
  if (
    !report?.ready ||
    report.blockers?.length ||
    !plan ||
    !/^[a-f0-9]{40}$/.test(plan.head) ||
    ![plan.inventoryDigest, plan.recordedDigest, plan.databaseFingerprint].every(
      (value) => /^[a-f0-9]{64}$/.test(value),
    ) ||
    typeof plan.includeAll !== "boolean" ||
    !Array.isArray(plan.pendingFiles) ||
    plan.pendingFiles.some(
      (file) => !/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(file),
    ) ||
    new Set(plan.pendingFiles).size !== plan.pendingFiles.length ||
    report.pendingCount !== plan.pendingFiles.length
  ) {
    throw new Error("migration_baseline_blocked");
  }
  return plan;
}

function verifyPreview(output, plan) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new Error("migration_preview_mismatch");
  }
  const expected = plan.pendingFiles.map((file) => file.split("/").at(-1));
  if (
    result.dryRun !== true ||
    !isDeepStrictEqual(result.migrations, expected) ||
    !isDeepStrictEqual(result.seeds, []) ||
    !isDeepStrictEqual(result.roles, [])
  ) {
    throw new Error("migration_preview_mismatch");
  }
}

export async function runMigrationDeployment({
  phase,
  planPath,
  connectionString,
  check = checkMigrationBaseline,
  runCli = runLockedCli,
}) {
  if (!["preview", "apply"].includes(phase) || !planPath || !connectionString) {
    throw new Error("invalid_migration_deployment_arguments");
  }
  let saved;
  if (phase === "apply") {
    try {
      saved = JSON.parse(await readFile(planPath, "utf8"));
    } catch {
      throw new Error("migration_plan_required");
    }
  }
  const plan = requirePlan(await check({ connectionString }));
  if (
    phase === "apply" &&
    (saved?.formatVersion !== 1 ||
      saved.cliVersion !== CLI_VERSION ||
      !isDeepStrictEqual(saved.migrationPlan, plan))
  ) {
    throw new Error("migration_plan_stale");
  }
  if ((await runCli(["--version"])).trim() !== CLI_VERSION) {
    throw new Error("migration_cli_version_mismatch");
  }
  const args = [
    "db",
    "push",
    "--db-url",
    connectionString,
    "--skip-vault",
    "--output-format",
    "json",
    "--yes",
  ];
  if (plan.includeAll) args.push("--include-all");
  verifyPreview(await runCli([...args, "--dry-run"]), plan);
  if (phase === "preview") {
    await writeFile(
      planPath,
      `${JSON.stringify({ formatVersion: 1, cliVersion: CLI_VERSION, migrationPlan: plan }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return {
      phase,
      head: plan.head,
      includeAll: plan.includeAll,
      pendingCount: plan.pendingFiles.length,
      pendingFiles: plan.pendingFiles,
    };
  }
  // The CLI preview can take time. Bind the mutation to a fresh inventory and
  // registry snapshot after it completes, as well as to the saved preview.
  if (!isDeepStrictEqual(requirePlan(await check({ connectionString })), plan)) {
    throw new Error("migration_plan_stale");
  }
  if (plan.pendingFiles.length) await runCli(args);
  const after = await check({ connectionString });
  const afterPlan = requirePlan(after);
  if (
    after.pendingCount !== 0 ||
    afterPlan.includeAll ||
    afterPlan.head !== plan.head ||
    afterPlan.inventoryDigest !== plan.inventoryDigest ||
    afterPlan.databaseFingerprint !== plan.databaseFingerprint
  ) {
    throw new Error("migration_postcheck_failed");
  }
  return {
    phase,
    head: afterPlan.head,
    pendingCount: 0,
    recordedCount: after.recordedCount,
    verified: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 5 || process.argv[3] !== "--plan") {
      throw new Error("invalid_migration_deployment_arguments");
    }
    const result = await runMigrationDeployment({
      phase: process.argv[2],
      planPath: process.argv[4],
      connectionString: process.env.SINGLE_STORE_DATABASE_URL,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const safe = new Set([
      "invalid_migration_deployment_arguments",
      "migration_plan_required",
      "migration_baseline_blocked",
      "migration_plan_stale",
      "migration_cli_version_mismatch",
      "migration_preview_mismatch",
      "migration_postcheck_failed",
      "migration_cli_failed",
    ]);
    process.stdout.write(
      `${JSON.stringify({ ready: false, error: safe.has(error.message) ? error.message : "migration_deployment_failed" })}\n`,
    );
    process.exitCode = 1;
  }
}
