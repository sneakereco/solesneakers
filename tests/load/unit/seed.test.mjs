import test from "node:test";
import assert from "node:assert/strict";
import { seedFixtures } from "../operator/seed.mjs";
import { targetFixture } from "./fixtures.mjs";
import { createFixtureClients } from "../operator/fixture-clients.mjs";

function memoryJournal() {
  const entries = new Map();
  return {
    records: () => [...entries.values()],
    async intent(kind, key, data) {
      const id = kind + key;
      if (!entries.has(id)) entries.set(id, { kind, key, data, status: "intent" });
      return entries.get(id);
    },
    async commit(kind, key, data) {
      Object.assign(entries.get(kind + key), {
        status: "committed",
        data: { ...entries.get(kind + key).data, ...data },
      });
    },
  };
}
test("adopt account after crash between create and journal commit", async () => {
  const accounts = new Map(),
    catalog = new Map(),
    journal = memoryJournal();
  let crashed = false,
    creates = 0;
  const clients = {
    accounts: {
      async ensure(data) {
        if (!accounts.has(data.id)) {
          accounts.set(data.id, data);
          creates++;
          if (!crashed) {
            crashed = true;
            throw Error("terminated");
          }
        }
        return accounts.get(data.id);
      },
    },
    catalog: {
      async ensure(data) {
        catalog.set(data.id, data);
        return data;
      },
    },
    async register() {},
  };
  const target = targetFixture(),
    plan = {
      runId: "11111111-1111-4111-8111-111111111111",
      targetDigest: target.digest,
      accountPoolSize: 2,
      ordinaryStockUnits: 1000,
      hotStock: 1,
    };
  await assert.rejects(seedFixtures(target, plan, clients, journal), /terminated/);
  const seeded = await seedFixtures(target, plan, clients, journal);
  await seedFixtures(target, plan, clients, journal);
  assert.equal(creates, 2);
  assert.equal(seeded.accounts.length, 2);
  assert.ok(
    seeded.products.filter((x) => !x.hot).reduce((n, x) => n + x.stock, 0) >= 1000,
  );
  assert.ok(seeded.accounts.every((x) => x.email.endsWith(`@${plan.runId}.load.test`)));
});
test("guest slots create no auth accounts", async () => {
  const fixtures = await seedFixtures(
    targetFixture(),
    {
      runId: "11111111-1111-4111-8111-111111111111",
      accountPoolSize: 0,
      ordinaryStockUnits: 10,
      hotStock: 10,
    },
    {
      accounts: {
        ensure() {
          assert.fail("unexpected auth");
        },
      },
      catalog: { ensure: async (d) => d },
      register: async () => {},
    },
    memoryJournal(),
  );
  assert.equal(fixtures.accounts.length, 0);
  assert.ok(fixtures.products.filter((x) => !x.hot).every((x) => x.stock >= 3));
});
test("unrelated existing auth identities are never adopted", async () => {
  const clients = createFixtureClients({
    runId: "our-run",
    admin: {
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { id: "x", email: "other@test.invalid", app_metadata: {} } },
          }),
        },
      },
    },
    db: {
      query() {
        assert.fail("unrelated write");
      },
    },
  });
  await assert.rejects(
    clients.accounts.ensure({ id: "x", email: "ours@test.invalid" }),
    /Unrelated/,
  );
});
