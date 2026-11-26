import test from "node:test";
import { accountSlotsForPlan } from "../operator/sessions.mjs";
test("operator stop during session preparation prevents further logins", async () => {
  let checks = 0,
    logins = 0;
  await assert.rejects(
    prepareSessionPool(
      {},
      { runId: "run" },
      { accounts: [{ id: "a" }, { id: "b" }] },
      {
        assertActive: async () => {
          if (checks++) throw Error("Operator stop requested");
        },
        auth: {
          login: async () => {
            logins++;
            return { cookies: [] };
          },
        },
      },
    ),
    /stop/,
  );
  assert.equal(logins, 1);
});
test("customer browser coverage includes both mobile and desktop without changing the overall account ratio", () => {
  const plan = {
    totalSlots: 10000,
    httpSlots: 9980,
    browserSlots: 20,
    browserViewports: { mobile: 14, desktop: 6 },
  };
  const slots = accountSlotsForPlan(plan);
  assert.equal(slots.size, 3000);
  assert.ok([...slots].some((slot) => slot >= 9980 && slot < 9994));
  assert.ok([...slots].some((slot) => slot >= 9994));
});
import assert from "node:assert/strict";
import { prepareSessionPool, leaseShopper } from "../operator/sessions.mjs";
test("10k logical sessions are unique and never lease account to two active slots", async () => {
  const pool = await prepareSessionPool(
    {},
    { runId: "run-id" },
    { accounts: [{ id: "one", email: "one@test.invalid", password: "private" }] },
    {
      auth: {
        login: async () => ({
          cookies: [{ name: "chunk.0", value: "old" }],
          expiresAt: 1,
        }),
        refresh: async () => ({
          cookies: [
            { name: "chunk.0", value: "new" },
            { name: "chunk.1", value: "new2" },
          ],
          expiresAt: Date.now() + 60000,
        }),
      },
    },
  );
  const account = await leaseShopper(pool, 0, 0, { account: true });
  assert.equal(account.cookies[0].value, "new");
  assert.equal(account.cookies.length, 2);
  await assert.rejects(leaseShopper(pool, 1, 0, { account: true }), /leased/);
  const ids = new Set();
  for (let i = 1; i <= 10000; i++) {
    const lease = await leaseShopper(pool, i, 0, { account: false });
    ids.add(lease.sessionId);
    assert.ok(!lease.password);
  }
  assert.equal(ids.size, 10000);
  await account.release();
  const next = await leaseShopper(pool, 0, 1, { account: true });
  assert.notEqual(next.sessionId, account.sessionId);
});
