import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDisposableLoadDatabase } from "./fixtures/load-test.mjs";
import { createFixtureClients } from "../load/operator/fixture-clients.mjs";
import { seedFixtures } from "../load/operator/seed.mjs";
import { openJournal } from "../load/operator/journal.mjs";
import { createCleanupClients, cleanupRun } from "../load/operator/cleanup.mjs";
test("actual scoped SQL cleanup can restart and preserves an unrelated catalog canary", async () => {
  const stack = await createDisposableLoadDatabase(),
    directory = await mkdtemp(join(tmpdir(), "sole-cleanup-"));
  try {
    const db = await stack.connect(),
      runId = randomUUID(),
      plan = {
        runId,
        targetDigest: "d",
        accountPoolSize: 0,
        ordinaryStockUnits: 30,
        hotStock: 1,
      },
      target = { digest: "d" },
      journal = await openJournal(plan, directory),
      control = async () => ({ cleaned: true });
    const fixtures = createFixtureClients({ db, runId, control });
    const canary = {
      id: randomUUID(),
      variantId: randomUUID(),
      brandId: randomUUID(),
      sizeId: randomUUID(),
      imageId: randomUUID(),
      name: "Load unrelated",
      runId: randomUUID(),
      sku: randomUUID(),
      stock: 3,
      priceCents: 1000,
    };
    await fixtures.catalog.ensure(canary);
    await seedFixtures(target, plan, fixtures, journal);
    const clients = createCleanupClients({ db, runId, journal, control });
    await clients.deleteOrders();
    assert.equal((await cleanupRun(target, journal, clients)).status, "cleaned");
    assert.equal(
      (await cleanupRun(target, await openJournal(plan, directory), clients)).status,
      "cleaned",
    );
    assert.equal(
      (await db.query("select name from public.products where id=$1", [canary.id]))
        .rows[0].name,
      canary.name,
    );
    assert.equal(
      (
        await db.query("select count(*)::int n from public.products where name like $1", [
          `Load ${runId}%`,
        ])
      ).rows[0].n,
      0,
    );
  } finally {
    await stack.close();
    await rm(directory, { recursive: true, force: true });
  }
});
