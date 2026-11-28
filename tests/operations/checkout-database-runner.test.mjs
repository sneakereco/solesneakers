import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runnerUrl = new URL(
  "../../scripts/test-checkout-hardening-db.mjs",
  import.meta.url,
);
async function runner() {
  return (await import(runnerUrl.href)).runCheckoutDatabaseChecks;
}
async function collect(flags = []) {
  const calls = [];
  await (
    await runner()
  )(async (...args) => {
    calls.push(args);
  }, flags);
  return calls;
}
const operations = "src/Modules/Checkout/Tests/Features/";
const stock = "tests/database/checkout-hardening-acceptance.test.mjs";
const suites = [
  ["fixture", "tests/database/checkout-hardening-fixture.test.mjs"],
  ["stock", stock],
  ["reseller-mail", "tests/database/reseller-order-notifications.test.mjs"],
  [
    "authority",
    "src/Modules/Orders/Tests/Features/TrustedMutations/authority.postgres.test.mjs",
  ],
  ["attempt-ledger", operations + "Payments/attempt-ledger.postgres.test.mjs"],
  [
    "financial-projection",
    operations + "Payments/financial-projection.postgres.test.mjs",
  ],
  ["reservation-races", operations + "Preparation/reservation-races.postgres.test.mjs"],
  ["work-storage", operations + "Recovery/work-storage.postgres.test.mjs"],
  ["recovery-fairness", operations + "Recovery/recovery-fairness.postgres.test.mjs"],
  ["recovery-capacity", operations + "Recovery/recovery-capacity.postgres.test.mjs"],
  ["expiry-races", operations + "Recovery/expiry-races.postgres.test.mjs"],
  ["checkout-controls", operations + "Operations/checkout-controls.postgres.test.mjs"],
  ["checkout-health", operations + "Operations/checkout-health.postgres.test.mjs"],
  [
    "shared-network-checkout",
    operations + "Operations/shared-network-checkout.postgres.test.mjs",
  ],
];

test("full database command preserves both modes of every original suite and both safety controls", async () => {
  const calls = await collect();
  assert.deepEqual(calls[0], [
    "owned-runtime",
    [
      "--input-type=module",
      "-e",
      'import {localDockerSocket} from "./tests/database/fixtures/checkout-hardening.mjs"; import {execFileSync} from "node:child_process"; await localDockerSocket(); execFileSync("docker",["version","--format","{{.Server.Version}}"],{timeout:10000});',
    ],
  ]);
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "owned-runtime",
      "stock-negative",
      "barrier-and-relay",
      ...["fresh", "populated"].flatMap((mode) =>
        suites.map(([name]) => mode + "-" + name),
      ),
    ],
  );
  for (const mode of ["fresh", "populated"]) {
    for (const [name, file] of suites) {
      assert.deepEqual(
        calls.find(([key]) => key === mode + "-" + name),
        [
          mode + "-" + name,
          ["scripts/test-checkout-hardening-db.mjs", "--mode", mode, "--test", file],
          {
            env: {
              CHECKOUT_HARDENING_SELF_TEST_MODE: mode,
              CHECKOUT_AUTHORITY_MODE: mode,
              CHECKOUT_LEDGER_MODE: mode,
              CHECKOUT_WORK_STORAGE_MODE: mode,
            },
          },
        ],
      );
      assert.ok(
        (await readFile(new URL("../../" + file, import.meta.url), "utf8")).length,
      );
    }
  }
  assert.deepEqual(calls[2][1], [
    "--test",
    "src/Modules/Checkout/Tests/Features/Operations/request-barrier.test.mjs",
    "tests/database/checkout-hardening-docker-relay.test.mjs",
  ]);
  const fault = calls[1];
  assert.deepEqual(fault[1], [
    "scripts/test-checkout-hardening-db.mjs",
    "--mode",
    "fresh",
    "--test",
    stock,
  ]);
  assert.equal(fault[2].env.CHECKOUT_GATE_FAULT, "stock");
  assert.equal(
    fault[2].expectedFailure,
    "stock stayed at 1 after the database rejected a negative balance",
  );
  assert.equal(fault[2].propagateFailure, false);
});

test("database shards collectively execute exactly the full commands and retain runtime validation on every runner", async () => {
  const full = await collect();
  const combined = [];
  for (const shard of [1, 2, 3, 4]) {
    const calls = await collect([`--shard=${shard}/4`]);
    assert.deepEqual(calls[0], full[0]);
    assert.ok(calls.length > 1);
    combined.push(...calls.slice(1));
  }
  const ordered = (calls) => [...calls].sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(ordered(combined), ordered(full.slice(1)));
  assert.equal(new Set(combined.map(([name]) => name)).size, 30);
});

test("stock failure injection is preserved on its owning shard and cannot report success when explicitly broken", async () => {
  const calls = await collect(["--shard=1/4", "--break-stock"]);
  assert.equal(
    calls.find(([name]) => name === "stock-negative")[2].propagateFailure,
    true,
  );
});

test("database gate failures propagate unchanged and stop the shard", async () => {
  const fail = Error("database safety check failed");
  let visited = 0;
  await assert.rejects(
    (await runner())(async () => {
      visited++;
      throw fail;
    }, ["--shard=3/4"]),
    (error) => error === fail,
  );
  assert.equal(visited, 1);
});

for (const flags of [
  ["--skip"],
  ["--shard=0/4"],
  ["--shard=5/4"],
  ["--shard=1/3"],
  ["--shard="],
  ["--shard=01/4"],
  ["--shard=1/4", "--shard=2/4"],
  ["--break-stock", "--break-stock"],
  ["--shard=2/4", "--break-stock"],
]) {
  test(`database rejects ${flags.join(" ")} before executing any gate`, async () => {
    let visited = 0;
    await assert.rejects(
      (await runner())(async () => {
        visited++;
      }, flags),
    );
    assert.equal(visited, 0);
  });
}
