import test from "node:test";
import assert from "node:assert/strict";
import { cleanupRun } from "../operator/cleanup.mjs";
test("cleanup refuses a changed target and preserves pending financial work", async () => {
  const journal = { targetDigest: "d", runId: "run", records: () => [] };
  let deleted = false;
  const clients = {
    snapshot: async () => ({
      unresolvedPayments: 1,
      unresolvedHolds: 0,
      notifications: 0,
    }),
    deleteOwned: async () => {
      deleted = true;
    },
  };
  await assert.rejects(cleanupRun({ digest: "different" }, journal, clients), /identity/);
  assert.equal(
    (await cleanupRun({ digest: "d" }, journal, clients)).status,
    "incomplete",
  );
  assert.equal(deleted, false);
});
test("cleanup resumes after each committed group and second cleanup is a no-op", async () => {
  for (const failAt of [0, 1, 2]) {
    const entries = ["catalog", "account", "registry"].map((kind, index) => ({
      kind,
      key: String(index),
      data: { id: String(index) },
      status: "committed",
    }));
    const journal = {
      targetDigest: "d",
      runId: "run",
      records: () => structuredClone(entries),
      markDeleted: async (kind, key) => {
        entries.find((x) => x.kind === kind && x.key === key).status = "deleted";
      },
    };
    let calls = 0,
      crashed = false;
    const removed = new Set(["unrelated"]);
    const clients = {
      snapshot: async () => ({
        unresolvedPayments: 0,
        unresolvedHolds: 0,
        notifications: 0,
      }),
      deleteOrders: async () => {},
      deleteOwned: async (entry) => {
        if (calls++ === failAt && !crashed) {
          crashed = true;
          throw Error("terminated");
        }
        removed.add(entry.data.id);
      },
      finish: async () => {},
    };
    assert.equal(
      (await cleanupRun({ digest: "d" }, journal, clients)).status,
      "incomplete",
    );
    assert.equal((await cleanupRun({ digest: "d" }, journal, clients)).status, "cleaned");
    const count = calls;
    assert.equal((await cleanupRun({ digest: "d" }, journal, clients)).status, "cleaned");
    assert.equal(calls, count);
    assert.ok(removed.has("unrelated"));
  }
});
