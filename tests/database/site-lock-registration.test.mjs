import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, beforeEach, afterEach, test } from "node:test";
import {
  prepareTestDatabase,
  seedActor,
  dropTestDatabase,
} from "./fixtures/specialty-claims.mjs";

// The shared fixture refuses non-local/non-disposable databases. No live Auth calls.
let db;
let owner;
let existingUser;
before(async () => {
  db = await prepareTestDatabase();
  await db.query(
    "drop trigger if exists guard_registration_while_store_locked on auth.users",
  );
  await db.query(
    await readFile(
      new URL(
        "../../supabase/migrations/20261127010000_block_signup_while_store_locked.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
after(async () => {
  await db?.end();
  if (db) await dropTestDatabase();
});
beforeEach(async () => {
  await db.query("begin");
  const actor = await seedActor(db);
  owner = actor.owner;
  existingUser = actor.actor;
});
afterEach(async () => {
  await db.query("rollback");
});

async function setLock(enabled, deadline) {
  await db.query(
    "insert into public.tenant_store_access_settings(tenant_id,site_lock_enabled,site_unlock_at) values($1,$2,$3) on conflict(tenant_id) do update set site_lock_enabled=excluded.site_lock_enabled,site_unlock_at=excluded.site_unlock_at",
    [owner, enabled, deadline],
  );
}
async function createUser(id = randomUUID()) {
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
    id,
    `fixture-${id}@example.invalid`,
    JSON.stringify({ role: "admin" }),
  ]);
  return id;
}
for (const [name, deadline] of [
  ["indefinite", null],
  ["future", "2099-01-01T00:00:00Z"],
]) {
  test(`the Auth database role cannot create a user under an ${name} lock`, async () => {
    await setLock(true, deadline);
    const id = randomUUID();
    await db.query("savepoint blocked_signup");
    await db.query("set local role supabase_auth_admin");
    await assert.rejects(
      createUser(id),
      /Customer registration is unavailable while the storefront is locked/,
    );
    await db.query("rollback to savepoint blocked_signup");
    assert.equal(
      (await db.query("select count(*)::int n from auth.users where id=$1", [id])).rows[0]
        .n,
      0,
    );
  });
}
test("disabled lock permits new users even if a future date remains", async () => {
  await setLock(false, "2099-01-01T00:00:00Z");
  await db.query("set local role supabase_auth_admin");
  assert.ok(await createUser());
});
test("scheduled opening permits new users once its timestamp has passed", async () => {
  await setLock(true, "2020-01-01T00:00:00Z");
  await db.query("set local role supabase_auth_admin");
  assert.ok(await createUser());
});
test("missing settings retain the existing open-store default", async () => {
  await db.query("delete from public.tenant_store_access_settings where tenant_id=$1", [
    owner,
  ]);
  await db.query("set local role supabase_auth_admin");
  assert.ok(await createUser());
});
test("an active lock leaves existing-user sign-in updates possible", async () => {
  await setLock(true, null);
  await db.query("set local role supabase_auth_admin");
  const result = await db.query(
    "update auth.users set last_sign_in_at=now() where id=$1",
    [existingUser],
  );
  assert.equal(result.rowCount, 1);
});
