import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { atRequestBarrier } from "./request-barrier.mjs";

for (const scenario of ["early response", "deadline"]) {
  test("releases the sibling and reports " + scenario, async () => {
    const sibling = Promise.withResolvers();
    let resumed = false;
    const waiting = atRequestBarrier({
      arrived: new Promise(() => {}),
      pending: [
        scenario === "early response" ? Promise.resolve(403) : sibling.promise,
        sibling.promise,
      ],
      resume() {
        resumed = true;
        sibling.resolve();
      },
      inspect() {
        assert.fail("incomplete barrier entered");
      },
      timeoutMs: 30,
    });
    try {
      await assert.rejects(
        Promise.race([
          waiting,
          delay(200).then(() => {
            throw Error("test watchdog");
          }),
        ]),
        scenario === "early response" ? /request 1 returned before/ : /barrier deadline/,
      );
      assert.equal(resumed, true);
    } finally {
      sibling.resolve();
    }
  });
}

test("a stalled handler after release has a bounded cleanup deadline", async () => {
  let resumed = false;
  await assert.rejects(
    atRequestBarrier({
      arrived: Promise.resolve(),
      pending: [new Promise(() => {})],
      resume: () => {
        resumed = true;
      },
      inspect: () => {},
      timeoutMs: 30,
    }),
    /barrier cleanup deadline/,
  );
  assert.equal(resumed, true);
});

test("a stalled independent observation releases both arrived handlers", async () => {
  const observation = Promise.withResolvers();
  const sibling = Promise.withResolvers();
  try {
    const result = atRequestBarrier({
      arrived: Promise.resolve(),
      pending: [sibling.promise, sibling.promise],
      resume: () => sibling.resolve("released"),
      inspect: () => observation.promise,
      timeoutMs: 30,
    });
    await assert.rejects(
      Promise.race([
        result,
        delay(200).then(() => {
          throw Error("test watchdog");
        }),
      ]),
      /barrier deadline/,
    );
    assert.equal(await sibling.promise, "released");
  } finally {
    observation.resolve();
    sibling.resolve("released");
  }
});
