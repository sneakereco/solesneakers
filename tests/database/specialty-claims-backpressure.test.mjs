import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import {
  prepareTestDatabase,
  connectTestDatabase,
  applySpecialtyMigrations,
  createRaceCampaign,
  cleanupRaceCampaign,
  seedPrize,
  claimAttempt,
  award,
  recover,
} from "./fixtures/specialty-claims.mjs";
let db, campaign;
before(async () => {
  db = await prepareTestDatabase();
  await applySpecialtyMigrations(db);
});
after(async () => {
  await db?.end();
});
beforeEach(async () => {
  campaign = await createRaceCampaign(db);
});
afterEach(async () => {
  await cleanupRaceCampaign(db, campaign);
});
const prize = (quantity) => seedPrize(db, { quantity, campaignSlug: campaign.slug });
const direct = (client, attempt) =>
  client
    .query("select public.accept_specialty_claim($1::jsonb) result", [
      JSON.stringify(attempt.command),
    ])
    .then((result) => result.rows[0].result);
test("a busy stocked prize promptly returns retryable without persisting a false loss", async () => {
  const item = await prize(1),
    attempt = claimAttempt(item, campaign),
    locker = await connectTestDatabase();
  try {
    await locker.query("begin");
    await locker.query("select id from public.products where id=$1 for update", [
      item.productId,
    ]);
    const started = performance.now();
    await assert.rejects(direct(db, attempt), (error) => error.code === "55P03");
    assert.ok(
      performance.now() - started < 500,
      "Do not hold a pool slot waiting behind a busy prize.",
    );
    assert.equal(await recover(db, attempt), null);
  } finally {
    await locker.query("rollback");
    await locker.end();
  }
  assert.equal((await award(db, attempt)).result.status, "won");
});
test("committed exhausted stock does not serialize losing attempts on the config lock", async () => {
  const item = await prize(1);
  await award(db, claimAttempt(item, campaign));
  const locker = await connectTestDatabase();
  try {
    await locker.query("begin");
    await locker.query(
      "select product_id from public.specialty_product_config where product_id=$1 for update",
      [item.productId],
    );
    assert.equal(
      (await direct(db, claimAttempt(item, campaign))).result.status,
      "sold_out",
    );
  } finally {
    await locker.query("rollback");
    await locker.end();
  }
});
test("a committed campaign identity cap does not wait on another prize config lock", async () => {
  const a = await prize(1),
    b = await prize(1);
  await award(db, claimAttempt(a, campaign, { addressId: "shared" }));
  const locker = await connectTestDatabase();
  try {
    await locker.query("begin");
    await locker.query(
      "select product_id from public.specialty_product_config where product_id=$1 for update",
      [b.productId],
    );
    assert.equal(
      (await direct(db, claimAttempt(b, campaign, { addressId: "shared" }))).result
        .status,
      "already_claimed",
    );
  } finally {
    await locker.query("rollback");
    await locker.end();
  }
});
