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

// Only closed gate names, counts and hashes are suitable for the CI log. Raw
// child output and browser screenshots stay in the private ephemeral run folder.
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
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [],
      stdoutChunks = [];
    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
      if (expectedFailure) stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    const status = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const raw = Buffer.concat(chunks);
    await writeFile(join(directory, name + ".log"), raw, { mode: 0o600, flag: "wx" });
    const output = raw.toString();
    const stdout =
      "\n" + Buffer.concat(stdoutChunks).toString().replaceAll("\r\n", "\n").trimEnd();
    const summary = expectedFailure ? finalTapSummary.exec(stdout) : null;
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
    if (expectedFailure && !detected)
      throw Error(family + " fault injection inconclusive: " + name);
    if (!passed)
      throw Error(family + " gate failed: " + (detected ? expectedFailure : name));
  };
}
