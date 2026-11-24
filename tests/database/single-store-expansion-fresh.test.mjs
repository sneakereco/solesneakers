import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import {
  applyExpansion,
  connect,
  expectSqlError,
  fingerprint,
  reserve,
  testUrl,
} from "./fixtures/single-store-expansion.mjs";

const target = testUrl(process.env.SINGLE_STORE_TEST_DATABASE_URL);
assert.equal(target.pathname, "/single_store_test_replay_20261123");
let db;
before(async () => {
  db = await connect(target.href);
});
after(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
});
afterEach(async () => {
  await db.query("rollback");
});

test("fresh full-baseline zero-owner schema expands without inventing identity or settings", async () => {
  assert.equal(
    (await db.query("select count(*)::int n from public.tenants")).rows[0].n,
    0,
  );
  const beforeRows = await fingerprint(db);
  await applyExpansion(db);
  assert.deepEqual(await fingerprint(db), beforeRows);
  await db.query("set local role service_role");
  await expectSqlError(db, () => reserve(db, {}), /single_store_existing_owner_required/);
  await expectSqlError(
    db,
    () =>
      db.query("select public.upsert_store_access_settings(false,null,false,'fixture')"),
    /single_store_existing_owner_required/,
  );
  await expectSqlError(
    db,
    () => db.query("select public.get_store_access_settings()"),
    /single_store_existing_owner_required/,
  );
  await db.query("reset role");
  assert.deepEqual(await fingerprint(db), beforeRows);
});

test("compatibility writes become available only after one real owner exists", async () => {
  await applyExpansion(db);
  await db.query("insert into public.tenants(name) values ('Fresh fixture real store')");
  await db.query("set local role service_role");
  const result = (
    await db.query(
      "select public.upsert_store_access_settings(false,null,true,'Fresh configured lock') value",
    )
  ).rows[0].value;
  assert.equal(result.checkout_lock_enabled, true);
  assert.equal(result.checkout_lock_message, "Fresh configured lock");
  await db.query("reset role");
  assert.equal(
    (await db.query("select count(*)::int n from public.tenants")).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.tenant_store_access_settings"))
      .rows[0].n,
    1,
  );
});

test("later second owner makes compatibility fail closed at execution time", async () => {
  await applyExpansion(db);
  await db.query(
    "insert into public.tenants(name) values ('Fresh owner one'),('Fresh owner two')",
  );
  await db.query("set local role service_role");
  await expectSqlError(
    db,
    () =>
      db.query("select public.upsert_store_access_settings(false,null,false,'fixture')"),
    /single_store_existing_owner_required/,
  );
  await db.query("reset role");
  assert.equal(
    (await db.query("select count(*)::int n from public.tenant_store_access_settings"))
      .rows[0].n,
    0,
  );
});
