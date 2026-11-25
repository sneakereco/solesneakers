import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

const marker = "sole-specialty-claims-disposable-v1";
export function testUrl(value = process.env.SPECIALTY_TEST_DATABASE_URL) {
  assert.ok(value, "Explicit SPECIALTY_TEST_DATABASE_URL required");
  const url = new URL(value);
  assert.ok(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.port === "64332" &&
      /^\/specialty_test_[a-z0-9_]+$/.test(url.pathname) &&
      !url.search,
    "Refusing non-disposable specialty target",
  );
  return url;
}
function connectUrl(url) {
  return new Client({ connectionString: url.href });
}
export async function connectTestDatabase() {
  const url = testUrl();
  const client = connectUrl(url);
  await client.connect();
  const { rows } = await client.query(
    "select current_database() name, shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()",
  );
  assert.equal(rows[0].name, decodeURIComponent(url.pathname.slice(1)));
  assert.equal(rows[0].marker, marker, "Unowned database refused");
  return client;
}
export async function prepareTestDatabase() {
  const url = testUrl();
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = connectUrl(adminUrl);
  await admin.connect();
  const name = url.pathname.slice(1);
  let client;
  try {
    const versions = new Set(
      (
        await admin.query("select version from supabase_migrations.schema_migrations")
      ).rows.map((row) => row.version),
    );
    const exists =
      (await admin.query("select 1 from pg_database where datname=$1", [name])).rowCount >
      0;
    if (!exists) {
      await admin.query('create database "' + name + '" owner postgres');
      const schema = execFileSync(
        "docker",
        [
          "exec",
          "supabase_db_solesneakers",
          "pg_dump",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "--schema-only",
          "--schema",
          "public",
          "--schema",
          "auth",
          "--schema",
          "storage",
          "--schema",
          "extensions",
        ],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      ).replace(/^CREATE SCHEMA extensions;\r?$/m, "");
      execFileSync(
        "docker",
        [
          "exec",
          "-i",
          "supabase_db_solesneakers",
          "psql",
          "-U",
          "supabase_admin",
          "-d",
          name,
          "-v",
          "ON_ERROR_STOP=1",
        ],
        {
          input:
            'drop schema public; create schema extensions; create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions;\n' +
            schema,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      await admin.query('comment on database "' + name + '" is ' + "'" + marker + "'");
    }
    client = await connectTestDatabase();
    await client.query(
      "create schema if not exists specialty_fixture; create table if not exists specialty_fixture.baseline(version text primary key); create table if not exists specialty_fixture.migrations(version text primary key)",
    );
    const ready = (
      await client.query(
        "select to_regprocedure('public._single_store_compat_owner()') is not null ready",
      )
    ).rows[0].ready;
    if (!ready) {
      for (const file of [
        "20260918180000_remove_marketing_and_contact_attachments.sql",
        "20260919090000_retire_unused_application_schema.sql",
        "20261123120000_single_store_compatibility.sql",
      ]) {
        if (
          versions.has(file.slice(0, 14)) ||
          (
            await client.query(
              "select 1 from specialty_fixture.baseline where version=$1",
              [file],
            )
          ).rowCount
        )
          continue;
        await client.query(
          await readFile(
            new URL("../../../supabase/migrations/" + file, import.meta.url),
            "utf8",
          ),
        );
        await client.query("insert into specialty_fixture.baseline(version) values($1)", [
          file,
        ]);
      }
    }
  } finally {
    await client?.end();
    await admin.end();
  }
  return connectTestDatabase();
}

export async function dropTestDatabase(value) {
  const url = testUrl(value);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = connectUrl(adminUrl);
  await admin.connect();
  try {
    const name = url.pathname.slice(1);
    const owned = (
      await admin.query(
        "select shobj_description(oid,'pg_database') marker from pg_database where datname=$1",
        [name],
      )
    ).rows[0];
    assert.equal(owned?.marker, marker, "Refusing cleanup of an unowned database");
    await admin.query('drop database "' + name + '"');
  } finally {
    await admin.end();
  }
}

export async function applySpecialtyMigrations(client) {
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  await client.query(
    "create table if not exists specialty_fixture.migrations(version text primary key)",
  );
  for (const file of (await readdir(dir))
    .filter((name) => /^20261125\d+_specialty_.*\.sql$/.test(name))
    .sort()) {
    if (
      (
        await client.query(
          "select 1 from specialty_fixture.migrations where version=$1",
          [file],
        )
      ).rowCount
    )
      continue;
    await client.query(await readFile(new URL(file, dir), "utf8"));
    await client.query("insert into specialty_fixture.migrations(version) values($1)", [
      file,
    ]);
  }
}
export async function seedActor(client) {
  let owner = (await client.query("select id from public.tenants limit 1")).rows[0]?.id;
  if (!owner)
    owner = (
      await client.query(
        "insert into public.tenants(name) values ('Specialty fixture store') returning id",
      )
    ).rows[0].id;
  const actor = randomUUID();
  await client.query("insert into auth.users(id,email) values($1,$2)", [
    actor,
    "specialty-" + actor + "@example.invalid",
  ]);
  return { actor, owner };
}
export function prizeInput(quantity = 1, overrides = {}) {
  return {
    mode: "create",
    name: "Fixture prize " + randomUUID(),
    description: "Synthetic test prize",
    images: [{ url: "https://example.invalid/prize.jpg", sortOrder: 0, isPrimary: true }],
    quantity,
    goLiveAt: "2026-01-01T00:00:00Z",
    instructions: null,
    ...overrides,
  };
}
export async function seedPrize(client, options = {}) {
  const { actor, owner } = await seedActor(client);
  const input = prizeInput(
    options.quantity ?? 1,
    options.campaignSlug ? { campaignSlug: options.campaignSlug } : {},
  );
  const result = (
    await client.query(
      "select public.save_specialty_product(null,$1::jsonb,$2::uuid,$3::uuid) result",
      [JSON.stringify(input), actor, owner],
    )
  ).rows[0].result;
  const config = (
    await client.query(
      "select * from public.specialty_product_config where product_id=$1",
      [result.productId],
    )
  ).rows[0];
  return {
    ...result,
    actor,
    owner,
    campaignId: config.campaign_id,
    variantId: config.variant_id,
    input,
  };
}
export async function readRunState(client, productId) {
  return (
    await client.query(
      "select (select count(*)::int from public.specialty_claims where product_id=$1) winners,(select stock from public.product_variants where product_id=$1) stock",
      [productId],
    )
  ).rows[0];
}
export function fixtureKey(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createRaceCampaign(client) {
  const { actor } = await seedActor(client);
  const slug = "fixture-race-" + randomUUID();
  const row = (
    await client.query(
      "insert into public.specialty_campaigns(slug) values($1) returning *",
      [slug],
    )
  ).rows[0];
  const keyFingerprint = fixtureKey("specialty-fixture-identity-secret");
  await client.query("select public.set_specialty_campaign_enabled($1,true,$2,$3,$4)", [
    row.id,
    Number(row.revision),
    actor,
    keyFingerprint,
  ]);
  return { id: row.id, slug, actor, keyFingerprint };
}
export function claimAttempt(prize, campaign, overrides = {}) {
  const seed = randomUUID();
  const handle =
    overrides.instagramHandle ?? "fixture_" + seed.replaceAll("-", "").slice(0, 12);
  const addressId = overrides.addressId ?? seed;
  const secret = fixtureKey("recovery:" + seed);
  const command = {
    attemptId: randomUUID(),
    recoveryHash: fixtureKey(secret),
    inputHash: fixtureKey("input:" + prize.productId + ":" + handle + ":" + addressId),
    payloadHash: fixtureKey(
      "payload:" + prize.productId + ":" + handle + ":" + addressId,
    ),
    eligibility: {
      campaignId: campaign.id,
      productId: prize.productId,
      browserId: "fixture-browser-context",
      instagramHandle: handle,
      address: {
        line1:
          "123 " +
          addressId.replaceAll("-", "").slice(0, 10).toUpperCase() +
          " FIXTURE ST",
        line2: null,
        city: "COLUMBIA",
        state: "SC",
        postalCode: "29201",
        country: "US",
      },
      addressKey: fixtureKey("address:" + campaign.id + ":" + addressId),
      instagramKey: fixtureKey("instagram:" + campaign.id + ":" + handle),
      normalizationVersion: 1,
      identityKeyFingerprint: campaign.keyFingerprint,
      expiresAt: Date.now() + 600000,
    },
  };
  return { command, recoverySecret: secret };
}
export async function award(client, attempt) {
  return (
    await client.query("select public.accept_specialty_claim($1::jsonb) result", [
      JSON.stringify(attempt.command),
    ])
  ).rows[0].result;
}
export async function recover(client, attempt) {
  return (
    await client.query("select public.read_specialty_claim_result($1,$2) result", [
      attempt.command.attemptId,
      fixtureKey(attempt.recoverySecret),
    ])
  ).rows[0].result;
}
export async function cleanupRaceCampaign(client, campaign) {
  assert.ok(campaign.slug.startsWith("fixture-race-"), "Refusing non-fixture cleanup");
  const products = (
    await client.query(
      "select product_id from public.specialty_product_config where campaign_id=$1",
      [campaign.id],
    )
  ).rows.map((row) => row.product_id);
  await client.query("delete from public.specialty_claim_attempts where campaign_id=$1", [
    campaign.id,
  ]);
  await client.query("delete from public.specialty_claims where campaign_id=$1", [
    campaign.id,
  ]);
  await client.query("delete from public.specialty_product_config where campaign_id=$1", [
    campaign.id,
  ]);
  if (products.length)
    await client.query("delete from public.products where id=any($1::uuid[])", [
      products,
    ]);
  await client.query("delete from public.specialty_campaigns where id=$1 and slug=$2", [
    campaign.id,
    campaign.slug,
  ]);
}

export async function asRole(client, role, callback) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role));
  await client.query("savepoint role_check");
  try {
    await client.query("set local role " + role);
    return await callback();
  } finally {
    await client.query("rollback to savepoint role_check");
    await client.query("release savepoint role_check");
  }
}
