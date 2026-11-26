import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openJournal } from "../load/operator/journal.mjs";
import { seedFixtures } from "../load/operator/seed.mjs";
import { parseTarget } from "../load/shared/contracts.mjs";
import { targetFixture } from "../load/unit/fixtures.mjs";
import { createDisposableLoadDatabase } from "./fixtures/load-test.mjs";
import { startDisposableAuth } from "../load/database/auth-stack.mjs";
import { createFixtureClients } from "../load/operator/fixture-clients.mjs";
import {
  createSessionAuth,
  prepareSessionPool,
  leaseShopper,
} from "../load/operator/sessions.mjs";
test("confirmed customer adoption and SSR refresh use actual isolated GoTrue and PostgreSQL", async () => {
  const stack = await createDisposableLoadDatabase({ authLedger: true });
  let auth;
  const directory = await mkdtemp(join(tmpdir(), "sole-load-auth-"));
  try {
    const db = await stack.connect();
    auth = await startDisposableAuth(stack.url);
    const admin = createClient(auth.url, auth.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const runId = randomUUID(),
      account = {
        id: randomUUID(),
        runId,
        email: `account0@${runId}.load.test`,
        password: randomBytes(32).toString("base64url"),
      };
    const clients = createFixtureClients({ admin, db, runId });
    await clients.accounts.ensure(account);
    await clients.accounts.ensure(account);
    assert.equal(
      (await db.query("select count(*)::int n from auth.users where id=$1", [account.id]))
        .rows[0].n,
      1,
    );
    const sessionAuth = createSessionAuth(
      { resources: { supabase: { url: auth.url } } },
      auth.publishableKey,
    );
    const pool = await prepareSessionPool(
      {},
      { runId },
      { accounts: [account] },
      { auth: sessionAuth },
    );
    assert.ok(pool.accounts[0].session.cookies.some((x) => x.name.startsWith("sb-")));
    const oldCookie = pool.accounts[0].session.cookies.map((x) => x.value).join("");
    pool.accounts[0].session.expiresAt = 0;
    const leased = await leaseShopper(pool, 0, 0, { account: true });
    assert.equal(leased.accountId, account.id);
    assert.ok(leased.cookies.length > 0);
    assert.notEqual(leased.cookies.map((x) => x.value).join(""), oldCookie);
    await leased.release();
    const target = parseTarget(targetFixture()),
      plan = {
        runId,
        targetDigest: target.digest,
        accountPoolSize: 2,
        ordinaryStockUnits: 100,
        hotStock: 1,
      };
    const journal = await openJournal(plan, directory);
    await journal.intent("account", "0", account);
    const seedClients = { ...clients, register: () => Promise.resolve() };
    await seedFixtures(target, plan, seedClients, journal);
    await seedFixtures(target, plan, seedClients, await openJournal(plan, directory));
    assert.equal(
      (
        await db.query("select count(*)::int n from public.products where name like $1", [
          `Load ${runId}%`,
        ])
      ).rows[0].n,
      21,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.profiles where email like $1",
          [`%@${runId}.load.test`],
        )
      ).rows[0].n,
      2,
    );
    const deleted = await admin.auth.admin.deleteUser(account.id);
    assert.equal(deleted.error, null);
  } finally {
    await auth?.close();
    await stack.close();
    await rm(directory, { recursive: true, force: true });
  }
});
