import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import {
  prepareTestDatabase,
  applySpecialtyMigrations,
  createRaceCampaign,
  cleanupRaceCampaign,
  seedPrize,
  claimAttempt,
  award,
  asRole,
} from "./fixtures/specialty-claims.mjs";
let db, campaign;
before(async () => {
  db = await prepareTestDatabase();
  await applySpecialtyMigrations(db);
  campaign = await createRaceCampaign(db);
});
after(async () => {
  if (campaign) await cleanupRaceCampaign(db, campaign);
  await db?.end();
});
test("private observation recovery adds immutable context and preserves legacy recovery shape", async () => {
  const item = await seedPrize(db, { quantity: 1, campaignSlug: campaign.slug });
  const attempt = claimAttempt(item, campaign);
  await award(db, attempt);
  const args = [attempt.command.attemptId, attempt.command.recoveryHash];
  const read = async (name, values = args) =>
    (await db.query("select public." + name + "($1::uuid,$2::text) result", values))
      .rows[0].result;
  const original = await read("read_specialty_claim_result");
  const enriched = await read("read_specialty_claim_result_with_context");
  assert.deepEqual(Object.keys(original).sort(), ["inputHash", "payloadHash", "result"]);
  assert.deepEqual(enriched, {
    ...original,
    productId: item.productId,
    campaignId: campaign.id,
  });
  await assert.rejects(
    read("read_specialty_claim_result_with_context", [args[0], "0".repeat(64)]),
    (error) => error.code === "42501",
  );
  await db.query("begin");
  try {
    for (const role of ["anon", "authenticated"])
      await assert.rejects(
        asRole(db, role, () => read("read_specialty_claim_result_with_context")),
        (error) => error.code === "42501",
      );
  } finally {
    await db.query("rollback");
  }
});
