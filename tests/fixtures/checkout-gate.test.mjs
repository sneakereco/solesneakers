import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCheckoutGate } from "./checkout-gate.mjs";

const marker = "stock stayed at 1 after the database rejected a negative balance";
const runner = await createCheckoutGate("diagnostic-regression");
const child = `
  import test from "node:test";
  const {CHECKOUT_PROBE_SCENARIO:scenario, CHECKOUT_PROBE_MARKER:marker} = process.env;
  test("stock", () => {
    if (scenario === "incidental-marker" || scenario === "outside-record") {
      console.log(marker);
      throw Error("unrelated failure");
    }
    if (scenario === "misleading-summary") console.log("fail 1");
    throw Error(marker);
  });
  if (["additional-failure","misleading-summary"].includes(scenario)) test("independent", () => { throw Error("second failure"); });
`;
const dir = await mkdtemp(join(tmpdir(), "checkout-tap-probe-"));
const file = join(dir, "probe.test.mjs");
await writeFile(file, child, { flag: "wx", mode: 0o600 });
test.after(async () => {
  await unlink(file);
  await rmdir(dir);
});
const supervised = ["--test", "--test-reporter=tap", file];
// The DB launcher prints fixture diagnostics before forwarding the child TAP.
// An error-looking line outside the TAP record must never identify its cause.
const wrapper = `
  import {spawnSync} from "node:child_process";
  console.log("  error: '"+process.env.CHECKOUT_PROBE_MARKER+"'");
  const child = spawnSync(process.execPath,process.argv.slice(1),{stdio:"inherit"});
  process.exitCode=child.status ?? 2;
`;
const run = (scenario) =>
  runner(
    scenario,
    scenario === "outside-record"
      ? ["--input-type=module", "-e", wrapper, "--", ...supervised]
      : supervised,
    {
      expectedFailure: marker,
      env: {
        NODE_TEST_CONTEXT: undefined,
        CHECKOUT_PROBE_SCENARIO: scenario,
        CHECKOUT_PROBE_MARKER: marker,
      },
    },
  );

for (const scenario of [
  "incidental-marker",
  "additional-failure",
  "misleading-summary",
  "outside-record",
]) {
  test("fault gate refuses " + scenario, async () => {
    await assert.rejects(run(scenario), /fault injection inconclusive/);
  });
}
test("fault gate recognizes the single identified error", () =>
  run("identified-rejection"));
