import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import {
  prepareTestDatabase,
  applySpecialtyMigrations,
  createRaceCampaign,
  cleanupRaceCampaign,
  seedPrize,
  claimAttempt,
  award,
  readRunState,
  asRole,
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
test("staff status transitions append actor/time audit without mutating acceptance or stock", async () => {
  const prize = await seedPrize(db, { campaignSlug: campaign.slug });
  const won = await award(db, claimAttempt(prize, campaign));
  const id = won.result.receipt.claimId;
  const beforeRow = (
    await db.query("select * from public.specialty_claims where id=$1", [id])
  ).rows[0];
  for (const [status, revision] of [
    ["contacted", 1],
    ["fulfilled", 2],
  ]) {
    const response = (
      await db.query("select public.update_specialty_claim_status($1,$2,$3,$4) result", [
        id,
        status,
        revision,
        prize.actor,
      ])
    ).rows[0].result;
    assert.equal(response.follow_up_status, status);
    assert.equal(Number(response.revision), revision + 1);
  }
  const afterRow = (
    await db.query("select * from public.specialty_claims where id=$1", [id])
  ).rows[0];
  for (const field of [
    "address_key",
    "instagram_key",
    "eligibility_address",
    "accepted_at",
    "instructions",
    "decision_ordinal",
  ])
    assert.deepEqual(afterRow[field], beforeRow[field]);
  assert.deepEqual(await readRunState(db, prize.productId), { winners: 1, stock: 0 });
  const audit = (
    await db.query(
      "select * from public.specialty_claim_status_audit where claim_id=$1 order by revision",
      [id],
    )
  ).rows;
  assert.equal(audit.length, 2);
  assert.equal(audit[0].previous_status, "new");
  assert.equal(audit[1].new_status, "fulfilled");
  assert.equal(audit[1].actor_id, prize.actor);
  assert.ok(audit[1].changed_at);
});
test("stale or invalid status mutations leave no audit entry", async () => {
  const prize = await seedPrize(db, { campaignSlug: campaign.slug });
  const id = (await award(db, claimAttempt(prize, campaign))).result.receipt.claimId;
  for (const [status, revision, pattern] of [
    ["contacted", 99, /specialty_revision_conflict/],
    ["refunded", 1, /specialty_invalid_status/],
  ]) {
    await assert.rejects(
      db.query("select public.update_specialty_claim_status($1,$2,$3,$4)", [
        id,
        status,
        revision,
        prize.actor,
      ]),
      pattern,
    );
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.specialty_claim_status_audit where claim_id=$1",
        [id],
      )
    ).rows[0].n,
    0,
  );
});
test("public/customer roles cannot read audit contacts or call the follow-up RPC", async () => {
  await db.query("begin");
  try {
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(
        asRole(db, role, () =>
          db.query("select * from public.specialty_claim_status_audit"),
        ),
        /permission denied/,
      );
      await assert.rejects(
        asRole(db, role, () =>
          db.query(
            "select public.update_specialty_claim_status(gen_random_uuid(),'contacted',1,gen_random_uuid())",
          ),
        ),
        /permission denied/,
      );
    }
    await assert.rejects(
      asRole(db, "service_role", () =>
        db.query("delete from public.specialty_claim_status_audit"),
      ),
      /permission denied/,
    );
  } finally {
    await db.query("rollback");
  }
});
