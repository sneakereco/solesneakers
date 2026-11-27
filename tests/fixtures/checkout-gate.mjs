import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const rejectedStockDiagnostic =
  "stock stayed at 1 after the database rejected a negative balance";

// The pinned Node TAP reporter ends stdout with this ordered block. Test
// console output is prefixed with "# " and can resemble individual counters.
const finalTapSummary =
  /\n1\.\.(?<plan>\d+)\n# tests (?<tests>\d+)\n# suites 0\n# pass (?<pass>\d+)\n# fail (?<fail>\d+)\n# cancelled (?<cancelled>\d+)\n# skipped (?<skipped>\d+)\n# todo (?<todo>\d+)\n# duration_ms \d+(?:\.\d+)?$/;

const fixturePhase =
  /^CHECKOUT_FIXTURE_PHASE (start|done) (docker-access|inventory|preflight|ports-config|docker-start|identity|clone|connect|replay|test|bootstrap-cleanup|resources-cleanup|directory-cleanup)$/;
const fixtureSource = String.raw`((?:scripts/test-checkout-hardening-db|tests/database/fixtures/checkout-hardening(?:-docker-relay)?)\.mjs:[1-9]\d{0,4})`;
const errorFrame = new RegExp(String.raw`^\s+at .*[/\\]${fixtureSource}:\d+\)?$`);
const fixtureError = new RegExp(
  String.raw`^CHECKOUT_FIXTURE_ERROR ([A-Za-z]+) ([A-Z0-9_]+|-) (?:${fixtureSource}|-)$`,
);
const errorNames = new Set([
  "Error",
  "AssertionError",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AggregateError",
]);
const errorCodes = new Set([
  "ERR_ASSERTION",
  "EACCES",
  "EADDRINUSE",
  "ECONNREFUSED",
  "ECONNRESET",
  "EIO",
  "ENOENT",
  "ENOSPC",
  "EPERM",
  "ETIMEDOUT",
  "08003",
  "08006",
  "22023",
  "23503",
  "23505",
  "23514",
  "25P02",
  "28P01",
  "42501",
  "42704",
  "42710",
  "42P01",
  "42P07",
  "53300",
  "55006",
  "57014",
  "57P01",
  "57P02",
  "57P03",
]);

export function reportCheckoutFixtureError(error) {
  if (process.env.CHECKOUT_GATE_DIAGNOSTICS !== "true") return;
  let cause = error;
  for (let depth = 0; cause && depth < 3; depth++, cause = cause.cause) {
    const frame =
      typeof cause.stack === "string"
        ? cause.stack
            .split("\n")
            .slice(1)
            .map((line) => errorFrame.exec(line.replaceAll("\\", "/")))
            .find(Boolean)
        : null;
    const name = errorNames.has(cause.name) ? cause.name : "Error";
    const code = errorCodes.has(cause.code) ? cause.code : "-";
    if (frame || code !== "-") {
      console.error(`CHECKOUT_FIXTURE_ERROR ${name} ${code} ${frame?.[1] ?? "-"}`);
    }
  }
}

function fixtureFailureDiagnostics(stderr, status, summary) {
  let fixture = "unavailable";
  let cleanup = "unavailable";
  const errors = [];
  for (const line of stderr.split(/\r?\n/)) {
    const phase = fixturePhase.exec(line);
    if (phase) {
      const [, state, name] = phase;
      if (name.endsWith("-cleanup")) cleanup = name + ":" + state;
      else fixture = name + ":" + state;
      continue;
    }
    const error = fixtureError.exec(line);
    if (!error || errors.length === 3) continue;
    const [, name, code, frame] = error;
    if (
      errorNames.has(name) &&
      (code === "-" || errorCodes.has(code)) &&
      (frame || code !== "-")
    ) {
      errors.push(`${name}:${code}@${frame ?? "-"}`);
    }
  }
  return [
    `fixture=${fixture} cleanup=${cleanup}`,
    `exit=${status ?? "signal"} tap=${summary ? "present" : "absent"}`,
    ...errors,
  ].join(" ");
}

function hasExpectedTapFailure(stdout, summary, message) {
  const header = stdout.lastIndexOf("\nTAP version 13\n");
  if (!summary || header < 0 || header >= summary.index) return false;
  const { plan, tests, pass, fail, cancelled, skipped, todo } = summary.groups;
  if (
    plan !== tests ||
    Number(pass) + 1 !== Number(tests) ||
    fail !== "1" ||
    cancelled !== "0" ||
    skipped !== "0" ||
    todo !== "0"
  )
    return false;

  const body = stdout.slice(header, summary.index);
  const results = [...body.matchAll(/^(not ok|ok) (\d+) - [^\n]+\n/gm)];
  if (
    results.length !== Number(tests) ||
    results.some((result, index) => Number(result[2]) !== index + 1)
  )
    return false;
  const failed = results.filter((result) => result[1] === "not ok");
  if (failed.length !== 1) return false;
  // Only inspect the delimited metadata immediately after the failed record.
  // Other records, wrapper diagnostics and test output cannot supply its error.
  const [result] = failed;
  const afterHeading = body.slice(result.index + result[0].length);
  const metadata = /^  ---\n((?:  [^\n]*\n)*?)  \.\.\.(?:\n|$)/.exec(afterHeading);
  if (!metadata) return false;
  const lines = metadata[1].split("\n");
  return lines.some(
    (line, index) =>
      line === "  error: '" + message + "'" ||
      line === "  error: " + message ||
      (line === "  error: |-" && lines[index + 1] === "    " + message),
  );
}

// Only closed diagnostic fields, counts and hashes are suitable for the CI log.
// Raw child output and screenshots stay in the private ephemeral run folder.
export async function createCheckoutGate(family) {
  const directory = await mkdtemp(
    join(process.env.CHECKOUT_GATE_PRIVATE_DIR ?? tmpdir(), "checkout-" + family + "-"),
  );
  if (!process.env.CI) console.log("Local diagnostics " + directory);
  return async (
    name,
    args,
    { env = {}, expectedFailure, propagateFailure = false } = {},
  ) => {
    assert.match(name, /^[a-z0-9-]+$/);
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        NODE_DISABLE_COLORS: "1",
        CHECKOUT_GATE_FAULT: "",
        CHECKOUT_BROWSER_OUTPUT: directory,
        ...env,
        CHECKOUT_GATE_DIAGNOSTICS: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [],
      stdoutChunks = [],
      stderrChunks = [];
    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      chunks.push(chunk);
      stderrChunks.push(chunk);
    });
    const status = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const raw = Buffer.concat(chunks);
    await writeFile(join(directory, name + ".log"), raw, { mode: 0o600, flag: "wx" });
    const output = raw.toString();
    const stdout =
      expectedFailure || status !== 0
        ? "\n" + Buffer.concat(stdoutChunks).toString().replaceAll("\r\n", "\n").trimEnd()
        : "";
    const summary = finalTapSummary.exec(stdout);
    const detected =
      expectedFailure &&
      status === 1 &&
      hasExpectedTapFailure(stdout, summary, expectedFailure);
    const passed = expectedFailure ? detected && !propagateFailure : status === 0;
    const countOutput = expectedFailure ? (summary?.[0] ?? "") : output;
    const counts = [
      ...countOutput.matchAll(/(?:ℹ |# )(tests|pass|fail|skipped|cancelled) (\d+)\b/g),
    ].map((m) => m[1] + "=" + m[2]);
    const hash = createHash("sha256").update(raw).digest("hex");
    const identity =
      output.match(
        /source=([a-f0-9]{40}) worktree=([a-f0-9]{64}) schema=([a-f0-9]{64}) migrations=(\d+)/,
      )?.[0] ?? "";
    console.log(
      [passed ? "PASS" : "FAIL", family, name, ...counts, identity, "sha256=" + hash]
        .filter(Boolean)
        .join(" "),
    );
    if (!passed) {
      const diagnostics = fixtureFailureDiagnostics(
        Buffer.concat(stderrChunks).toString(),
        status,
        summary,
      );
      console.log(`Checkout gate diagnostics ${family} ${name} ${diagnostics}`);
    }
    if (expectedFailure && !detected)
      throw Error(family + " fault injection inconclusive: " + name);
    if (!passed)
      throw Error(family + " gate failed: " + (detected ? expectedFailure : name));
  };
}
