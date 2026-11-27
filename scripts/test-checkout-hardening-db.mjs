#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  createCheckoutGate,
  rejectedStockDiagnostic,
} from "../tests/fixtures/checkout-gate.mjs";
import {
  localDockerSocket,
  root,
  withCheckoutProject,
} from "../tests/database/fixtures/checkout-hardening.mjs";

const exec = promisify(execFile);
const selfTestPath = "tests/database/checkout-hardening-fixture.test.mjs";
const deliberateFailure = "checkout_hardening_deliberate_gate_failure";

function parseArgs(args) {
  if (args.some((arg) => arg === "--database-url" || arg.startsWith("--database-url="))) {
    throw new Error("Database targets are allocated by the harness");
  }
  if (args.length === 1 && args[0] === "--self-test") return { selfTest: true };
  if (["--acceptance", "--acceptance --break-stock"].includes(args.join(" ")))
    return { acceptance: true, brokenStock: args.length === 2 };
  let mode = "fresh";
  let testPath;
  while (args.length) {
    const option = args.shift();
    const value = args.shift();
    if (option === "--test" && value && !testPath) testPath = value;
    else if (option === "--mode" && ["fresh", "populated"].includes(value)) mode = value;
    else
      throw new Error(
        "Usage: node scripts/test-checkout-hardening-db.mjs --self-test or [--mode fresh|populated] --test <test.mjs>",
      );
  }
  assert.ok(testPath, "Specify --self-test or --test <test.mjs>");
  return { mode, testPath };
}

async function resolveTestPath(testPath) {
  const [workspace, file] = await Promise.all([
    realpath(root),
    realpath(resolve(root, testPath)),
  ]);
  const inside = relative(workspace, file);
  assert.ok(
    inside &&
      inside !== ".." &&
      !inside.startsWith(".." + sep) &&
      !isAbsolute(inside) &&
      /\.test\.mjs$/.test(file),
    "Expected a Node .test.mjs file inside this worktree",
  );
  return file;
}

function report({ projectId, source, workingTree, schema, mode, migrations }) {
  console.log(
    "Checkout fixture " +
      mode +
      " project=" +
      projectId +
      " source=" +
      source +
      " worktree=" +
      workingTree +
      " schema=" +
      schema +
      " migrations=" +
      migrations,
  );
}

function scrub(text) {
  return text.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[database URL removed]");
}

async function nodeTest(file, fixture, extraEnv = {}) {
  return new Promise((resolveTest, reject) => {
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", file], {
      cwd: root,
      env: {
        ...process.env,
        ...fixture.childEnv,
        CHECKOUT_HARDENING_INDUCE_FAILURE: "",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status, signal) => {
      resolveTest({ status, signal, stdout: scrub(stdout), stderr: scrub(stderr) });
    });
  });
}

function checkTestResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(
    result.status,
    0,
    "Checkout Node test failed" + (result.signal ? " (" + result.signal + ")" : ""),
  );
}

// Use the running application container as a read-only observer when present.
// No application credentials, row values, or application connection URL are read.
async function applicationFingerprint() {
  await localDockerSocket();
  const container = "supabase_db_solesneakers";
  const local = { cwd: root, timeout: 30_000 };
  const result = await exec("docker", ["ps", "--format", "{{.Names}}"], local);
  if (!result.stdout.split(/\r?\n/).includes(container)) return null;
  const sql = [
    "begin isolation level repeatable read read only;",
    "select md5(string_agg(schemaname || '.' || tablename || '=' || row_fingerprint::text, ';' order by schemaname,tablename))",
    "from pg_tables, lateral query_to_xml(format(",
    "$query$select count(*) as n, md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),'')) as digest from %I.%I r$query$,",
    "schemaname, tablename), true, false, '') as row_fingerprint",
    "where schemaname in ('public','auth','storage','supabase_migrations');",
    "commit;",
  ].join(" ");
  const { stdout } = await exec(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-X",
      "--no-password",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atq",
      "-c",
      sql,
    ],
    local,
  );
  const fingerprint = stdout.trim();
  assert.match(fingerprint, /^[0-9a-f]{32}$/);
  return fingerprint;
}

async function selfTest() {
  const file = await resolveTestPath(selfTestPath);
  const applicationBefore = await applicationFingerprint();
  const rejected = await new Promise((resolveTest, reject) => {
    const child = spawn(
      process.execPath,
      [
        "scripts/test-checkout-hardening-db.mjs",
        "--test",
        selfTestPath,
        "--database-url",
        "postgresql://postgres:fixture@127.0.0.1:64332/postgres",
      ],
      { cwd: root, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (text) => {
      stderr += text;
    });
    child.once("error", reject);
    child.once("close", (status) => resolveTest({ status, stderr }));
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Database targets are allocated by the harness/);
  assert.equal(
    await applicationFingerprint(),
    applicationBefore,
    "Rejected setup changed the application database",
  );

  for (const mode of ["fresh", "populated"]) {
    const rehearsal = withCheckoutProject(
      mode,
      async (fixture) => {
        report(fixture);
        checkTestResult(
          await nodeTest(file, fixture, { CHECKOUT_HARDENING_SELF_TEST_MODE: mode }),
        );
        if (mode === "fresh") {
          const failed = await nodeTest(file, fixture, {
            CHECKOUT_HARDENING_SELF_TEST_MODE: mode,
            CHECKOUT_HARDENING_INDUCE_FAILURE: "1",
          });
          assert.notEqual(failed.status, 0, "Deliberate checkout gate reported success");
          assert.match(failed.stdout + failed.stderr, new RegExp(deliberateFailure));
          console.log("Detected deliberate failure in real Node test");
          throw new Error(deliberateFailure);
        }
      },
      {
        verifyFailedClone: mode === "fresh",
        onResourceReceipt: (entry) =>
          console.log("Checkout Docker " + mode + " " + JSON.stringify(entry)),
      },
    );
    if (mode === "fresh") await assert.rejects(rehearsal, { message: deliberateFailure });
    else await rehearsal;
    assert.equal(
      await applicationFingerprint(),
      applicationBefore,
      "Owned setup or cleanup changed the application database",
    );
    console.log("Verified " + mode + " replay and owned cleanup");
  }
  console.log(
    applicationBefore === null
      ? "No local application observer was running. The isolated platform bootstrap fingerprint was verified."
      : "Application database fingerprint unchanged after rejected setup and both owned project cleanups",
  );
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.acceptance) {
    const gate = await createCheckoutGate("database");
    const operations = "src/Modules/Checkout/Tests/Features/";
    const stock = "tests/database/checkout-hardening-acceptance.test.mjs";
    const run = (mode, file) => [
      "scripts/test-checkout-hardening-db.mjs",
      "--mode",
      mode,
      "--test",
      file,
    ];
    await gate("owned-runtime", [
      "--input-type=module",
      "-e",
      'import {localDockerSocket} from "./tests/database/fixtures/checkout-hardening.mjs"; import {execFileSync} from "node:child_process"; await localDockerSocket(); execFileSync("docker",["version","--format","{{.Server.Version}}"],{timeout:10000});',
    ]);
    await gate("stock-negative", run("fresh", stock), {
      env: { CHECKOUT_GATE_FAULT: "stock" },
      expectedFailure: rejectedStockDiagnostic,
      propagateFailure: args.brokenStock,
    });
    await gate("barrier-and-relay", [
      "--test",
      "src/Modules/Checkout/Tests/Features/Operations/request-barrier.test.mjs",
      "tests/database/checkout-hardening-docker-relay.test.mjs",
      "tests/fixtures/checkout-gate.test.mjs",
    ]);
    for (const mode of ["fresh", "populated"]) {
      const env = {
        CHECKOUT_HARDENING_SELF_TEST_MODE: mode,
        CHECKOUT_AUTHORITY_MODE: mode,
        CHECKOUT_LEDGER_MODE: mode,
        CHECKOUT_WORK_STORAGE_MODE: mode,
      };
      for (const [name, file] of [
        ["fixture", "tests/database/checkout-hardening-fixture.test.mjs"],
        ["stock", stock],
        [
          "authority",
          "src/Modules/Orders/Tests/Features/TrustedMutations/authority.postgres.test.mjs",
        ],
        ...[
          "Payments/attempt-ledger",
          "Payments/financial-projection",
          "Preparation/reservation-races",
          "Recovery/work-storage",
          "Recovery/recovery-fairness",
          "Recovery/expiry-races",
          "Operations/checkout-controls",
          "Operations/checkout-health",
          "Operations/shared-network-checkout",
        ].map((p) => [p.split("/")[1], operations + p + ".postgres.test.mjs"]),
      ])
        await gate(mode + "-" + name, run(mode, file), { env });
    }
  } else if (args.selfTest) {
    await selfTest();
  } else {
    const file = await resolveTestPath(args.testPath);
    let result;
    await withCheckoutProject(args.mode, async (fixture) => {
      report(fixture);
      result = await nodeTest(file, fixture);
    });
    console.log("Verified owned checkout project cleanup");
    checkTestResult(result);
  }
} catch (error) {
  console.error(scrub(error.message));
  process.exitCode = 1;
}
