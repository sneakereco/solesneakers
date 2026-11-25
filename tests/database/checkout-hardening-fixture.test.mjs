import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertFreshTarget,
  assertPopulatedRowsPreserved,
  populatedRows,
  withCheckoutDatabase,
  claimProjectDirectory,
  removeOwnedDirectory,
  validateMutationTarget,
} from "./fixtures/checkout-hardening.mjs";

const projectId = "checkout-hardening-test-0123456789abcd";
const database = "checkout_hardening_test_0123456789abcd";
const expected = { database, port: 56123 };
const local = "postgresql://postgres:fixture@127.0.0.1:56123";
const valid = local + "/" + database;

test("mutation URLs require the exact owned loopback database", () => {
  assert.equal(validateMutationTarget(valid, expected).pathname, "/" + database);
  for (const url of [
    valid.replace("127.0.0.1", "example.invalid"),
    local + "/postgres",
    valid + "?sslmode=require",
    valid + "#elsewhere",
    valid + "?",
    valid + "#",
    valid.replace("56123", "64332"),
  ]) {
    assert.throws(
      () => validateMutationTarget(url, expected),
      /Refusing mutation target/,
    );
  }
});

test("rejects_foreign_targets_without_touching_application_data", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "checkout-guard-"));
  const target = join(workspace, projectId);
  const application = join(target, "application.sql");
  try {
    await mkdir(target);
    await writeFile(application, "select 'existing application data'");
    const applicationBefore = await readFile(application);
    await assert.rejects(claimProjectDirectory(workspace, projectId), /already exists/);
    const rejected = spawnSync(
      process.execPath,
      [
        "scripts/test-checkout-hardening-db.mjs",
        "--test",
        "tests/database/checkout-hardening-fixture.test.mjs",
        "--database-url",
        local + "/postgres",
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Database targets are allocated by the harness/);
    const applicationAfter = await readFile(application);
    assert.deepEqual(applicationAfter, applicationBefore);
    await unlink(application);
    await rmdir(target);
  } finally {
    // Only this test's mkdtemp tree is removed.
    await rm(workspace, { recursive: true, force: true });
  }
});

test("cleanup requires an intact ownership marker and contained path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "checkout-guard-"));
  const outside = await mkdtemp(join(tmpdir(), "checkout-outside-"));
  try {
    const ownership = await claimProjectDirectory(workspace, projectId);
    await assert.rejects(
      removeOwnedDirectory({ ...ownership, directory: outside }),
      /outside the owned workspace/,
    );
    const marker = await readFile(ownership.marker);
    await unlink(ownership.marker);
    await assert.rejects(
      removeOwnedDirectory(ownership),
      /Missing checkout ownership marker/,
    );
    await writeFile(ownership.marker, marker);
    await removeOwnedDirectory(ownership);
    await assert.rejects(readFile(ownership.marker), { code: "ENOENT" });
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

if (process.env.CHECKOUT_HARDENING_SELF_TEST_MODE) {
  test("replays schema and exposes independent real role connections", async () => {
    const mode = process.env.CHECKOUT_HARDENING_SELF_TEST_MODE;
    await withCheckoutDatabase(mode, async (fixture) => {
      const { admin, connect, barrier, seedCatalog, seedOrder, populated } = fixture;
      const [
        {
          rows: [identity],
        },
        {
          rows: [variant],
        },
      ] = await Promise.all([
        admin.query("select current_database() as database"),
        admin.query("select to_regclass('public.product_variants')::text as table_name"),
      ]);
      assert.match(identity.database, /^checkout_hardening_test_[0-9a-f]{14}$/);
      assert.equal(variant.table_name, "product_variants");
      // Attempting to claim this already allocated target must preserve its rows.
      await assert.rejects(assertFreshTarget(admin, identity.database), /already exists/);
      if (mode === "populated") {
        const {
          rows: [saved],
        } = await admin.query(
          "select o.status, o.total::text, v.stock from orders o cross join product_variants v where o.id=$1 and v.id=$2",
          [populated.orderId, populated.variantId],
        );
        assert.deepEqual(saved, { status: "paid", total: "19.87", stock: 3 });
      }
      const catalog = await seedCatalog({ stock: 2 });
      const order = await seedOrder({ totalCents: 1225 });
      assert.ok(catalog.productId && catalog.variantId && order.orderId && order.userId);
      const gate = barrier(2);
      const readers = await Promise.all(["authenticated", "service_role"].map(connect));
      const reads = readers.map(async (client) => {
        await gate.wait();
        return (
          await client.query("select current_user as role, pg_backend_pid() as pid")
        ).rows[0];
      });
      gate.release();
      const identities = await Promise.all(reads);
      assert.deepEqual(
        identities.map(({ role }) => role),
        ["authenticated", "service_role"],
      );
      assert.notEqual(identities[0].pid, identities[1].pid);
      if (process.env.CHECKOUT_HARDENING_INDUCE_FAILURE === "1") {
        assert.fail("checkout_hardening_deliberate_gate_failure");
      }
    });
  });
}

if (process.env.CHECKOUT_HARDENING_SELF_TEST_MODE === "populated") {
  test("detects a mutation of the seeded auth user while the profile stays intact", async () => {
    await withCheckoutDatabase("populated", async ({ admin, populated }) => {
      const read = () => populatedRows(admin, populated, populated);
      const before = await read();
      await admin.query("begin");
      try {
        const { rowCount } = await admin.query(
          "update auth.users set role = 'fixture_changed' where id = $1",
          [populated.userId],
        );
        assert.equal(rowCount, 1);
        const after = await read();
        assert.deepEqual(after.profile, before.profile);
        assert.throws(
          () => assertPopulatedRowsPreserved(before, after),
          /Populated fixture changed its auth user/,
        );
      } finally {
        await admin.query("rollback");
      }
      assertPopulatedRowsPreserved(before, await read());
    });
  });
}
