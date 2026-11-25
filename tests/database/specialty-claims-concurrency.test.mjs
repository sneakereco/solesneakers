import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  prepareTestDatabase,
  connectTestDatabase,
  applySpecialtyMigrations,
  seedPrize,
  createRaceCampaign,
  cleanupRaceCampaign,
  claimAttempt,
  award,
  recover,
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
const prize = (quantity) => seedPrize(db, { quantity, campaignSlug: campaign.slug });
async function race(attempts) {
  const clients = await Promise.all(attempts.map(() => connectTestDatabase()));
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const pending = clients.map(async (client, index) => {
      await barrier;
      return award(client, attempts[index]);
    });
    release();
    return await Promise.all(pending);
  } finally {
    await Promise.all(clients.map((client) => client.end()));
  }
}
test("one unit has exactly one committed winner under independent competing transactions", async () => {
  const item = await prize(1);
  const outcomes = await race(
    Array.from({ length: 20 }, () => claimAttempt(item, campaign)),
  );
  assert.equal(outcomes.filter((value) => value.result.status === "won").length, 1);
  assert.equal(outcomes.filter((value) => value.result.status === "sold_out").length, 19);
  assert.deepEqual(await readRunState(db, item.productId), { winners: 1, stock: 0 });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.order_items where product_id=$1",
        [item.productId],
      )
    ).rows[0].n,
    0,
  );
});
test("quantity ten yields ten distinct winners and never negative stock", async () => {
  const item = await prize(10);
  const outcomes = await race(
    Array.from({ length: 30 }, () => claimAttempt(item, campaign)),
  );
  assert.equal(outcomes.filter((value) => value.result.status === "won").length, 10);
  assert.equal(outcomes.filter((value) => value.result.status === "sold_out").length, 20);
  assert.deepEqual(await readRunState(db, item.productId), { winners: 10, stock: 0 });
});
for (const shared of ["address", "instagram"]) {
  test(
    "cross-product competition enforces the shared " + shared + " cap atomically",
    async () => {
      const a = await prize(1),
        b = await prize(1);
      const overrides =
        shared === "address"
          ? { addressId: "shared-address" }
          : { instagramHandle: "shared_fixture" };
      const outcomes = await race([
        claimAttempt(a, campaign, overrides),
        claimAttempt(b, campaign, overrides),
      ]);
      assert.equal(outcomes.filter((value) => value.result.status === "won").length, 1);
      assert.equal(
        outcomes.filter((value) => value.result.status === "already_claimed").length,
        1,
      );
      const states = [
        await readRunState(db, a.productId),
        await readRunState(db, b.productId),
      ];
      assert.equal(
        states.reduce((sum, state) => sum + state.stock, 0),
        1,
      );
      assert.equal(
        states.reduce((sum, state) => sum + state.winners, 0),
        1,
      );
    },
  );
}
test("duplicate submissions return one original receipt and use one unit", async () => {
  const item = await prize(2);
  const attempt = claimAttempt(item, campaign);
  const results = await race(Array.from({ length: 10 }, () => attempt));
  const first = results.find((value) => !value.replayed);
  assert.equal(first.result.status, "won");
  assert.equal(results.filter((value) => !value.replayed).length, 1);
  for (const result of results) assert.deepEqual(result.result, first.result);
  assert.deepEqual(await readRunState(db, item.productId), { winners: 1, stock: 1 });
});
test("changed payload or credentials cannot hijack a recorded attempt", async () => {
  const item = await prize(2),
    attempt = claimAttempt(item, campaign);
  await award(db, attempt);
  await assert.rejects(
    award(db, { ...attempt, command: { ...attempt.command, inputHash: "f".repeat(64) } }),
    /specialty_payload_conflict/,
  );
  await assert.rejects(
    award(db, {
      ...attempt,
      command: { ...attempt.command, recoveryHash: "f".repeat(64) },
    }),
    /specialty_attempt_unauthorized/,
  );
  await assert.rejects(
    recover(db, { ...attempt, recoverySecret: "b".repeat(64) }),
    /specialty_attempt_unauthorized/,
  );
  assert.deepEqual(await readRunState(db, item.productId), { winners: 1, stock: 1 });
});
test("lost response after commit recovers the same receipt after close, archive and proof expiry", async () => {
  const item = await prize(1),
    attempt = claimAttempt(item, campaign);
  const original = await award(db, attempt);
  await db.query("update public.products set archived_at=clock_timestamp() where id=$1", [
    item.productId,
  ]);
  const revision = (
    await db.query("select revision from public.specialty_campaigns where id=$1", [
      campaign.id,
    ])
  ).rows[0].revision;
  await db.query("select public.set_specialty_campaign_enabled($1,false,$2,$3,null)", [
    campaign.id,
    Number(revision),
    campaign.actor,
  ]);
  const recovered = await recover(db, attempt);
  assert.deepEqual(recovered.result, original.result);
  const expired = {
    ...attempt,
    command: {
      ...attempt.command,
      eligibility: { ...attempt.command.eligibility, expiresAt: Date.now() - 1000 },
    },
  };
  assert.deepEqual((await award(db, expired)).result, original.result);
  assert.deepEqual(await readRunState(db, item.productId), { winners: 1, stock: 0 });
});
test("rollback before commit consumes no stock or eligibility and retry can win", async () => {
  const item = await prize(1),
    attempt = claimAttempt(item, campaign);
  const contender = await connectTestDatabase();
  try {
    await contender.query("begin");
    assert.equal((await award(contender, attempt)).result.status, "won");
    assert.equal(await recover(db, attempt), null);
    await contender.query("rollback");
  } finally {
    await contender.end();
  }
  assert.deepEqual(await readRunState(db, item.productId), { winners: 0, stock: 1 });
  assert.equal((await award(db, attempt)).result.status, "won");
});
test("a sold-out attempt does not consume its claimant's campaign allowance", async () => {
  const a = await prize(1),
    b = await prize(1);
  await award(db, claimAttempt(a, campaign));
  const loser = {
    addressId: "unclaimed-destination",
    instagramHandle: "unclaimed_fixture",
  };
  assert.equal(
    (await award(db, claimAttempt(a, campaign, loser))).result.status,
    "sold_out",
  );
  assert.equal((await award(db, claimAttempt(b, campaign, loser))).result.status, "won");
});
test("admin stale saves and explicit restocking cannot restore awarded stock", async () => {
  const item = await prize(2);
  await award(db, claimAttempt(item, campaign));
  const stale = {
    ...item.input,
    mode: "update",
    productId: item.productId,
    expectedRevision: item.revision,
  };
  delete stale.quantity;
  await assert.rejects(
    db.query("select public.save_specialty_product($1,$2::jsonb,$3,$4)", [
      item.productId,
      JSON.stringify(stale),
      item.actor,
      item.owner,
    ]),
    /specialty_revision_conflict/,
  );
  const current = (
    await db.query(
      "select revision from public.specialty_product_config where product_id=$1",
      [item.productId],
    )
  ).rows[0].revision;
  await assert.rejects(
    db.query("select public.save_specialty_product($1,$2::jsonb,$3,$4)", [
      item.productId,
      JSON.stringify({ ...stale, expectedRevision: Number(current), quantity: 2 }),
      item.actor,
      item.owner,
    ]),
    /specialty_stock_locked_after_claim/,
  );
  assert.deepEqual(await readRunState(db, item.productId), { winners: 1, stock: 1 });
});
test("expired proof or changed identity key cannot consume a prize", async () => {
  const item = await prize(1),
    attempt = claimAttempt(item, campaign);
  for (const edit of [
    { expiresAt: Date.now() - 1000 },
    { identityKeyFingerprint: "f".repeat(64) },
  ]) {
    await assert.rejects(
      award(db, {
        ...attempt,
        command: {
          ...attempt.command,
          eligibility: { ...attempt.command.eligibility, ...edit },
        },
      }),
      /specialty_proof_expired|specialty_identity_key_mismatch/,
    );
  }
  assert.deepEqual(await readRunState(db, item.productId), { winners: 0, stock: 1 });
});

test("quantity edit racing the first claim either precedes it or conflicts without restoring stock", async () => {
  const item = await prize(1);
  const editor = await connectTestDatabase(),
    claimant = await connectTestDatabase();
  try {
    const input = {
      ...item.input,
      mode: "update",
      expectedRevision: 1,
      quantity: 2,
      campaignSlug: campaign.slug,
    };
    const [saved, claimed] = await Promise.allSettled([
      editor.query("select public.save_specialty_product($1,$2::jsonb,$3,$4)", [
        item.productId,
        JSON.stringify(input),
        item.actor,
        item.owner,
      ]),
      award(claimant, claimAttempt(item, campaign)),
    ]);
    assert.equal(claimed.status, "fulfilled");
    assert.equal(claimed.value.result.status, "won");
    if (saved.status === "rejected")
      assert.match(
        saved.reason.message,
        /specialty_revision_conflict|specialty_stock_locked_after_claim/,
      );
    assert.deepEqual(await readRunState(db, item.productId), {
      winners: 1,
      stock: saved.status === "fulfilled" ? 1 : 0,
    });
  } finally {
    await Promise.all([editor.end(), claimant.end()]);
  }
});
test("a blocked product does not block independent prizes behind a campaign-wide write lock", async () => {
  const a = await prize(1),
    b = await prize(1);
  const blocker = await connectTestDatabase(),
    claimant = await connectTestDatabase();
  let pending;
  try {
    await blocker.query("begin");
    await blocker.query("select id from public.products where id=$1 for update", [
      a.productId,
    ]);
    pending = award(claimant, claimAttempt(a, campaign));
    pending.catch(() => {});
    for (let i = 0; i < 50; i++) {
      const wait = (
        await db.query("select wait_event_type from pg_stat_activity where pid=$1", [
          claimant.processID,
        ])
      ).rows[0]?.wait_event_type;
      if (wait === "Lock") break;
      await delay(10);
    }
    const result = await Promise.race([
      award(db, claimAttempt(b, campaign)),
      delay(1200).then(() => {
        throw new Error("independent product was blocked");
      }),
    ]);
    assert.equal(result.result.status, "won");
    await blocker.query("rollback");
    assert.equal((await pending).result.status, "won");
  } finally {
    await blocker.query("rollback");
    if (pending) await pending.catch(() => {});
    await Promise.all([blocker.end(), claimant.end()]);
  }
});
test("customer roles cannot award or recover private claims by calling RPCs directly", async () => {
  const item = await prize(1),
    attempt = claimAttempt(item, campaign);
  await db.query("begin");
  try {
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(
        asRole(db, role, () => award(db, attempt)),
        /permission denied/,
      );
      await assert.rejects(
        asRole(db, role, () => recover(db, attempt)),
        /permission denied/,
      );
    }
  } finally {
    await db.query("rollback");
  }
});
