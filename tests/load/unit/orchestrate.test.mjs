import test from "node:test";
import assert from "node:assert/strict";
import {
  executeRun,
  executeAcceptance,
  executeSelectedProfile,
} from "../operator/orchestrate.mjs";
test("selected diagnostic load performs a functional smoke first and stops on its failure", async () => {
  for (const failed of [true, false]) {
    const calls = [];
    await executeSelectedProfile("peak", async (profile) => {
      calls.push(profile);
      return {
        status: failed ? "fail" : "unmet",
        gates: [
          {
            name: failed ? "durable-invariants" : "tier-parity",
            status: failed ? "fail" : "unmet",
          },
        ],
        cleanup: { status: "cleaned" },
      };
    });
    assert.deepEqual(calls, failed ? ["smoke"] : ["smoke", "peak"]);
  }
});
import { main } from "../operator/cli.mjs";
test("acceptance includes bounded perimeter and Sandbox stages and preserves all absent specialty branches", async () => {
  const calls = [];
  const result = await executeAcceptance(
    { budget: { maxDurationSeconds: 86400, maxRequests: 1000000 } },
    {
      capabilities: ["shopping"],
      run: async (profile) => {
        calls.push(profile);
        return { profile, status: "pass", cleanup: { status: "cleaned" } };
      },
    },
  );
  assert.ok(calls.includes("perimeter"));
  assert.ok(calls.includes("sandbox"));
  assert.equal(
    result.stages.filter((x) => x.profile === "claim-rush" && x.status === "unmet")
      .length,
    5,
  );
  assert.equal(result.status, "unmet");
});
test("acceptance stops later load after a lower failure and records unrun branches", async () => {
  const calls = [];
  const result = await executeAcceptance(
    { budget: { maxDurationSeconds: 86400, maxRequests: 1000000 } },
    {
      run: async (profile) => {
        calls.push(profile);
        return { profile, status: "fail", cleanup: { status: "cleaned" } };
      },
    },
  );
  assert.deepEqual(calls, ["smoke"]);
  assert.equal(result.status, "fail");
  assert.ok(result.stages.some((x) => x.profile === "soak" && x.status === "unmet"));
});
function setup(failAt) {
  const order = [];
  const phase = (name) => async () => {
    order.push(name);
    if (failAt === name) throw Error(name);
    return name === "preflight"
      ? { allowed: true, coverage: [] }
      : name === "measure"
        ? { workers: [], telemetry: { samples: [], availability: {} } }
        : name === "assert"
          ? {}
          : name === "cleanup"
            ? { status: "cleaned" }
            : { status: "pass" };
  };
  return {
    order,
    deps: {
      plan: { runId: "fixture", targetDigest: "d", profile: "smoke" },
      phase: Object.fromEntries(
        [
          "preflight",
          "recheck",
          "register",
          "seed",
          "sessions",
          "measure",
          "revoke",
          "drain",
          "assert",
          "cleanup",
          "report",
        ].map((name) => [name, phase(name)]),
      ),
      evaluate: () => ({ status: "pass", gates: [], operations: [] }),
    },
  };
}
test("preflight failure produces a report without fixtures or traffic", async () => {
  const { order, deps } = setup("preflight");
  const report = await executeRun({ digest: "d" }, "smoke", deps);
  assert.equal(report.status, "unmet");
  assert.deepEqual(order, ["preflight", "report"]);
});
test("every lifecycle failure still revokes, reports and safely attempts cleanup", async () => {
  for (const failure of [
    "recheck",
    "register",
    "seed",
    "sessions",
    "measure",
    "drain",
    "assert",
  ]) {
    const { order, deps } = setup(failure);
    const report = await executeRun({ digest: "d" }, "smoke", deps);
    assert.ok(["unmet", "fail"].includes(report.status));
    assert.equal(order.at(-1), "report");
    if (order.includes("register")) {
      assert.ok(order.includes("revoke"));
      assert.ok(order.includes("cleanup"));
    }
  }
});
test("normal lifecycle orders seed sessions coordinated measurement drain assertion and cleanup", async () => {
  const { order, deps } = setup();
  await executeRun({ digest: "d" }, "smoke", deps);
  assert.deepEqual(order, [
    "preflight",
    "recheck",
    "register",
    "seed",
    "sessions",
    "recheck",
    "measure",
    "revoke",
    "drain",
    "assert",
    "report",
    "cleanup",
    "report",
  ]);
});
test("dry acceptance is side effect free and includes every requested branch", async () => {
  let output;
  const code = await main(["--dry-run", "--profile", "acceptance"], {
    print: (value) => (output = value),
  });
  assert.equal(code, 0);
  for (const label of [
    "cold",
    "warm",
    "arrival",
    "claim-rush",
    "stress",
    "soak",
    "redis-outage",
    "sandbox",
    "perimeter",
  ])
    assert.ok(JSON.stringify(output).includes(label));
});
test("CLI strict parsing rejects unknown flags and never treats missing run IDs as a new run", async () => {
  for (const args of [["--stop"], ["--unknown"], ["--cleanup", "../../other"]])
    assert.equal(await main(args, { print: () => {} }), 2);
});
