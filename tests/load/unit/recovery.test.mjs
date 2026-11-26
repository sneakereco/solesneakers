import test from "node:test";
import assert from "node:assert/strict";
import { drainRun } from "../operator/cleanup.mjs";
test("browser loss and restored dependencies cannot hide pending accepted payment", async () => {
  let now = 0,
    reads = 0;
  const journal = { targetDigest: "digest", records: () => [] };
  const result = await drainRun(
    { digest: "digest" },
    { runId: "run", targetDigest: "digest", drainSeconds: 2 },
    {
      now: () => now,
      pause: async (ms) => {
        now += ms;
      },
      snapshot: async () => {
        reads++;
        return {
          unresolvedHolds: 0,
          unresolvedPayments: 1,
          notifications: 0,
          oldestDeliverableSeconds: 0,
        };
      },
    },
    journal,
  );
  assert.equal(result.status, "incomplete");
  assert.ok(reads > 1);
  assert.equal(result.unresolved.unresolvedPayments, 1);
});
test("Redis or database timeout leaves recovery incomplete without zero substitution", async () => {
  const result = await drainRun(
    { digest: "d" },
    { targetDigest: "d", drainSeconds: 0 },
    {
      snapshot: async () => {
        throw Error("database timeout");
      },
    },
    { targetDigest: "d" },
  );
  assert.equal(result.status, "incomplete");
  assert.ok(result.reasons.length);
});
test("SMTP restoration is observed through the real interval and no worker is accelerated", async () => {
  let now = 0,
    calls = 0;
  const result = await drainRun(
    { digest: "d" },
    { targetDigest: "d", drainSeconds: 601 },
    {
      now: () => now,
      pause: async (ms) => {
        now += ms;
      },
      snapshot: async () => ({
        unresolvedHolds: 0,
        unresolvedPayments: 0,
        notifications: ++calls < 3 ? 1 : 0,
        oldestDeliverableSeconds: 0,
      }),
    },
    { targetDigest: "d" },
  );
  assert.equal(result.status, "drained");
  assert.ok(now >= 600000);
});
test("recovery saves durable evidence before cleanup and retains fixtures on storage failure", async () => {
  const { recoverOwnedRun } = await import("../operator/cleanup.mjs");
  let deleted = false;
  await assert.rejects(
    recoverOwnedRun({
      drain: async () => ({ status: "drained" }),
      collect: async () => ({ captures: ["capture"] }),
      cleanup: async () => {
        deleted = true;
        return { status: "cleaned" };
      },
      save: async () => {
        throw Error("disk full");
      },
    }),
    /disk full/,
  );
  assert.equal(deleted, false);
  const order = [];
  await recoverOwnedRun({
    drain: async () => ({}),
    collect: async () => ({}),
    save: async (value) => {
      order.push(value.cleanup ? "final" : "evidence");
    },
    cleanup: async () => {
      order.push("cleanup");
      return { status: "cleaned" };
    },
  });
  assert.deepEqual(order, ["evidence", "cleanup", "final"]);
});
