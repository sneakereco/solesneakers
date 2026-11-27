import assert from "node:assert/strict";
import test from "node:test";
import { createCheckoutGate } from "./checkout-gate.mjs";

const marker = "stock stayed at 1 after the database rejected a negative balance";
const runner = await createCheckoutGate("diagnostic-regression");
const child = `
  import test from "node:test";
  const [scenario, marker] = process.argv.slice(1);
  test("stock", () => {
    if (scenario === "incidental-marker") {
      console.log(marker);
      throw Error("unrelated failure");
    }
    throw Error(marker);
  });
  if (scenario === "additional-failure") test("independent", () => { throw Error("second failure"); });
`;
const run = (scenario) =>
  runner(
    scenario,
    ["--test-reporter=tap", "--input-type=module", "-e", child, scenario, marker],
    {
      expectedFailure: marker,
      // The nested process should use the same text reporter as the CLI, not the
      // node:test supervisor's private binary channel.
      env: { NODE_TEST_CONTEXT: undefined },
    },
  );

for (const scenario of ["incidental-marker", "additional-failure"]) {
  test("fault gate refuses " + scenario, async () => {
    await assert.rejects(run(scenario), /fault injection inconclusive/);
  });
}
test("fault gate recognizes the single identified error", () =>
  run("identified-rejection"));
