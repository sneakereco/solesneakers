import { Client } from "pg";
import { randomBytes } from "node:crypto";
export function disposableLoadUrl(value) {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== "64332" ||
    !/^\/single_store_test_load_[a-f0-9]+$/.test(url.pathname) ||
    url.search
  )
    throw Error("Refusing non-disposable load database");
  return url;
}
export async function createDisposableLoadDatabase({ authLedger = false } = {}) {
  const name = `single_store_test_load_${randomBytes(8).toString("hex")}`;
  const admin = new Client({
    connectionString: "postgresql://postgres:postgres@127.0.0.1:64332/postgres",
  });
  await admin.connect();
  const template =
    process.env.LOAD_TEST_TEMPLATE_DATABASE ?? "single_store_test_expansion_20261123";
  if (!/^single_store_test_[a-z0-9_]+$/.test(template))
    throw Error("Invalid disposable schema template");
  try {
    await admin.query(`create database "${name}" template "${template}"`);
  } catch {
    await admin.end();
    throw Error(
      "Disposable baseline unavailable: start local Supabase and replay the repository baseline into LOAD_TEST_TEMPLATE_DATABASE",
    );
  }
  const url = disposableLoadUrl(`postgresql://postgres:postgres@127.0.0.1:64332/${name}`);
  const clients = [];
  return {
    url: url.href,
    async connect() {
      const db = new Client({ connectionString: url.href });
      await db.connect();
      clients.push(db);
      if (authLedger) {
        const source = new Client({
          connectionString:
            "postgresql://supabase_auth_admin:postgres@127.0.0.1:64332/postgres",
        });
        const destination = new Client({
          connectionString: url.href.replace(
            "postgres:postgres@",
            "supabase_auth_admin:postgres@",
          ),
        });
        await source.connect();
        await destination.connect();
        try {
          const schema =
            "select md5(string_agg(table_name||column_name||data_type||coalesce(column_default,''),',' order by table_name,ordinal_position)) hash from information_schema.columns where table_schema='auth'";
          if (
            (await source.query(schema)).rows[0].hash !==
            (await destination.query(schema)).rows[0].hash
          )
            throw Error(
              "Disposable auth schema differs from installed local GoTrue baseline",
            );
          // Schema-only application rehearsals omit Auth's migration *data*.
          // Copy only version numbers, after positively matching its schema.
          const versions = (
            await source.query("select version from auth.schema_migrations")
          ).rows.map((row) => row.version);
          for (const version of versions)
            await destination.query(
              "insert into auth.schema_migrations(version) values($1) on conflict do nothing",
              [version],
            );
          authLedger = false;
        } finally {
          await source.end();
          await destination.end();
        }
      }
      return db;
    },
    async close() {
      for (const db of clients) await db.end();
      try {
        await admin.query(`drop database "${name}"`);
      } finally {
        await admin.end();
      }
    },
  };
}
