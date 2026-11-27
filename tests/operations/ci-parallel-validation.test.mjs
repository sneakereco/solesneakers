import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");
const workflow = load(
  readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
);
const lanes = ["scope", "checks", "database", "browser"];
const jobs = workflow.jobs;
const steps = Object.values(jobs).flatMap((job) => job.steps ?? []);
const step = (name) => {
  const matches = steps.filter((entry) => entry.name === name);
  assert.equal(matches.length, 1, `Expected exactly one ${name} step`);
  return matches[0];
};

test("database and browser lanes can start together without waiting for ordinary validation", () => {
  assert.deepEqual(Object.keys(jobs).sort(), [...lanes, "validate"].sort());
  assert.equal(jobs.checks.needs, undefined);
  for (const name of ["database", "browser"]) {
    assert.deepEqual([jobs[name].needs].flat(), ["scope"]);
    assert.equal(jobs[name].if, undefined, "Unconditional suites must still run");
  }
  assert.deepEqual([...jobs.validate.needs].sort(), [...lanes].sort());
  assert.match(jobs.validate.if, /always\(\)/);
});

test("retains every nonduplicate validation command and the existing scope rules", () => {
  for (const command of [
    "npm run format:check",
    "npm run lint",
    "npm run typecheck",
    "npm run test:jest:unit -- --runInBand",
    "npm run test:jest:integration -- --runInBand",
    "npm run test:checkout:db",
    "npm run test:checkout:browser",
    "node --test --test-concurrency=1 tests/database/checkout-migration-order.test.mjs",
    "npm run test:measurement:browser",
    "npm run test:analytics:browser",
    '"$RUNNER_TEMP/checkout-check" fixture-build ./node_modules/.bin/next build',
  ]) {
    assert.equal(steps.filter(({ run }) => run?.includes(command)).length, 1, command);
  }
  const operations = step("Release reconciliation operation gates").run;
  for (const file of [
    "tests/database/migration-reconciliation.test.mjs",
    "tests/operations/migration-deployment.test.mjs",
    "tests/operations/admin-analytics-warehouse-bindings.test.mjs",
    "tests/operations/admin-analytics-runtime-sync.test.mjs",
    "tests/operations/admin-analytics-observers.test.mjs",
    "tests/operations/admin-analytics-observer-clock.test.mjs",
    "tests/operations/checkout-validation-scope.test.mjs",
    "tests/fixtures/checkout-gate.test.mjs",
    "tests/operations/ci-parallel-validation.test.mjs",
    "tests/operations/checkout-browser-runner.test.mjs",
  ])
    assert.ok(operations.includes(file), file);
  assert.equal(
    jobs.scope.outputs.database,
    "${{ steps.checkout_scope.outputs.database }}",
  );
  assert.equal(
    jobs.scope.outputs.chromium,
    "${{ steps.checkout_scope.outputs.chromium }}",
  );
  assert.equal(
    step("Isolated checkout database gates").if,
    "needs.scope.outputs.database == 'true'",
  );
  assert.equal(
    step("Checkout Chromium gates").if,
    "needs.scope.outputs.chromium == 'true'",
  );
  for (const name of [
    "Rehearse hosted bootstrap and checkout migration ordering",
    "Measurement browser suites",
    "Analytics browser suites",
  ])
    assert.equal(step(name).if, undefined, `${name} must remain unconditional`);
});

test("each parallel lane installs its own dependencies and required runtimes", () => {
  assert.equal(
    jobs.scope?.steps.find(({ uses }) => uses?.startsWith("actions/setup-node@"))?.with
      .cache,
    undefined,
    "The scope-only job must not publish an empty npm download cache",
  );
  for (const name of ["checks", "database", "browser"]) {
    assert.ok(jobs[name], `Missing ${name} lane`);
    const lane = jobs[name].steps;
    assert.ok(lane.some(({ uses }) => uses?.startsWith("actions/checkout@")));
    assert.ok(
      lane.some(
        ({ uses, with: config }) =>
          uses?.startsWith("actions/setup-node@") && config["node-version"] === "24.14.1",
      ),
    );
    assert.ok(lane.some(({ run }) => run === "npm ci"));
  }
  assert.ok(
    jobs.browser.steps.some(
      ({ run, if: condition }) =>
        run?.includes("playwright install --with-deps chromium") &&
        condition === undefined,
    ),
  );
  assert.ok(
    jobs.database.steps.some(
      ({ run }) =>
        run?.includes("docker pull redis@sha256:") &&
        run.includes("docker pull postgrest/postgrest@sha256:"),
    ),
  );
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.env.SQUARE_ENVIRONMENT, "sandbox");
});

function runFinalGate(results) {
  const command = step("Require every CI lane").run;
  const match = /^node --input-type=module -e '([\s\S]+)'\s*$/.exec(command.trim());
  assert.ok(match, "The final gate must execute a portable Node result check");
  return spawnSync(process.execPath, ["--input-type=module", "-e", match[1]], {
    encoding: "utf8",
    env: { ...process.env, CI_JOB_RESULTS: JSON.stringify(results) },
  });
}
const successful = () =>
  Object.fromEntries(lanes.map((name) => [name, { result: "success" }]));

test("required validate succeeds only after all lanes pass", () => {
  assert.equal(runFinalGate(successful()).status, 0);
});
for (const name of lanes) {
  for (const status of ["failure", "cancelled", "skipped", "missing"]) {
    test(`required validate fails when ${name} is ${status}`, () => {
      const results = successful();
      if (status === "missing") delete results[name];
      else results[name].result = status;
      const result = runFinalGate(results);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(name), result.stderr);
    });
  }
}
