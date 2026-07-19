import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
const databaseUrl =
  process.env.RLS_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:64322/postgres";
const parsedDatabaseUrl = new URL(databaseUrl);

if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsedDatabaseUrl.hostname)) {
  throw new Error("RLS checks only run against a local database.");
}

const marker = `rls-${randomUUID()}`;
const tenantA = randomUUID();
const tenantB = randomUUID();
const adminUser = randomUUID();
const customerUser = randomUUID();

function createClient() {
  return new Client({ connectionString: databaseUrl });
}

async function runAs<T>(
  role: "anon" | "authenticated",
  userId: string | null,
  callback: (client: Client) => Promise<T>,
): Promise<T> {
  const client = createClient();
  await client.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role, sub: userId }),
    ]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function expectDenied(callback: () => Promise<unknown>) {
  await assert.rejects(callback, (error) => {
    return (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42501"
    );
  });
}

async function setup() {
  const client = createClient();
  await client.connect();
  try {
    await client.query(
      "insert into public.tenants (id, name) values ($1, $3), ($2, $4)",
      [tenantA, tenantB, `${marker}-tenant-a`, `${marker}-tenant-b`],
    );
    await client.query(
      "insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $3), ($2, 'authenticated', 'authenticated', $4)",
      [
        adminUser,
        customerUser,
        `${marker}-admin@example.com`,
        `${marker}-customer@example.com`,
      ],
    );
    await client.query(
      `insert into public.profiles (id, email, role, tenant_id)
       values ($1, $3, 'admin', $5), ($2, $4, 'customer', $5)
       on conflict (id) do update
       set email = excluded.email, role = excluded.role, tenant_id = excluded.tenant_id`,
      [
        adminUser,
        customerUser,
        `${marker}-admin@example.com`,
        `${marker}-customer@example.com`,
        tenantA,
      ],
    );
    await client.query(
      `insert into public.tag_brands (tenant_id, canonical_label, is_active)
       values (null, $1, true), (null, $2, false), ($3, $4, true)`,
      [`${marker}-active`, `${marker}-inactive`, tenantA, `${marker}-tenant-active`],
    );
  } finally {
    await client.end();
  }
}

async function cleanup() {
  const client = createClient();
  await client.connect();
  try {
    await client.query("delete from public.tag_sizes where canonical_label like $1", [
      `${marker}%`,
    ]);
    await client.query("delete from public.tag_brands where canonical_label like $1", [
      `${marker}%`,
    ]);
    await client.query("delete from public.profiles where id = any($1::uuid[])", [
      [adminUser, customerUser],
    ]);
    await client.query("delete from auth.users where id = any($1::uuid[])", [
      [adminUser, customerUser],
    ]);
    await client.query("delete from public.tenants where id = any($1::uuid[])", [
      [tenantA, tenantB],
    ]);
  } finally {
    await client.end();
  }
}

async function main() {
  await setup();
  try {
    const publicLabels = await runAs("anon", null, async (client) => {
      const result = await client.query<{ canonical_label: string }>(
        "select canonical_label from public.tag_brands where canonical_label like $1",
        [`${marker}%`],
      );
      return result.rows.map((row) => row.canonical_label);
    });
    assert(publicLabels.includes(`${marker}-active`));
    assert(publicLabels.includes(`${marker}-tenant-active`));
    assert(!publicLabels.includes(`${marker}-inactive`));

    await expectDenied(() =>
      runAs("anon", null, (client) =>
        client.query("insert into public.tag_brands (canonical_label) values ($1)", [
          `${marker}-anon-write`,
        ]),
      ),
    );
    await expectDenied(() =>
      runAs("authenticated", customerUser, (client) =>
        client.query(
          "insert into public.tag_sizes (tenant_id, size_type, canonical_label) values ($1, 'custom', $2)",
          [tenantA, `${marker}-customer-write`],
        ),
      ),
    );

    await runAs("authenticated", adminUser, (client) =>
      client.query(
        "insert into public.tag_sizes (tenant_id, size_type, canonical_label) values ($1, 'custom', $2)",
        [tenantA, `${marker}-admin-write`],
      ),
    );
    await expectDenied(() =>
      runAs("authenticated", adminUser, (client) =>
        client.query(
          "insert into public.tag_sizes (tenant_id, size_type, canonical_label) values ($1, 'custom', $2)",
          [tenantB, `${marker}-cross-tenant-write`],
        ),
      ),
    );

    process.stdout.write("Taxonomy RLS checks passed.\n");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
