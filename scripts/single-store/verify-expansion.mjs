import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

const CONTRACTS = [
  [
    "old_reservation",
    "reserve_square_checkout_inventory(uuid,uuid,text,text,text,text,text,text,timestamp with time zone,integer,integer,integer,integer,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)",
    true,
  ],
  [
    "new_reservation",
    "reserve_square_checkout_inventory(uuid,text,text,text,text,text,text,timestamp with time zone,integer,integer,integer,integer,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)",
    true,
  ],
  [
    "reservation_without_billing",
    "reserve_square_checkout_inventory_without_billing(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,integer,integer,integer,text,text,jsonb,jsonb,jsonb)",
    false,
  ],
  [
    "reservation_with_address",
    "reserve_square_checkout_inventory_with_address(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,integer,integer,integer,text,text,jsonb,jsonb,jsonb)",
    false,
  ],
  ["private_owner", "_single_store_compat_owner()", false],
  ["settings_read", "get_store_access_settings()", true],
  [
    "settings_write",
    "upsert_store_access_settings(boolean,timestamp with time zone,boolean,text)",
    true,
  ],
];

function explicitConnection(value) {
  if (!value) throw new Error("explicit_connection_url_required");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_connection_url");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  ) {
    throw new Error("invalid_connection_url");
  }
  return url.href;
}

async function contract(client, signature, serviceEntry) {
  const { rows } = await client.query(
    `select p.prosecdef as "securityDefiner", p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role
    from pg_proc p where p.oid=to_regprocedure($1)`,
    [`public.${signature}`],
  );
  const row = rows[0];
  return {
    present: Boolean(row),
    ready: Boolean(
      row &&
        row.securityDefiner &&
        row.proconfig?.includes('search_path=""') &&
        !row.anon &&
        !row.authenticated &&
        row.service_role === serviceEntry,
    ),
    permissions: row
      ? {
          anon: row.anon,
          authenticated: row.authenticated,
          service_role: row.service_role,
        }
      : null,
  };
}

async function fingerprints(client) {
  const result = {};
  const { rows } = await client.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  for (const { tablename } of rows) {
    // pg_tables is untrusted catalog input for identifier interpolation.
    if (!/^[a-z_]+$/.test(tablename)) throw new Error("unexpected_table_identifier");
    result[tablename] = (
      await client.query(`SELECT count(*)::integer AS rows,
      md5(coalesce(string_agg(value::text, E'\\n' ORDER BY value::text),'')) AS hash,
      md5(coalesce(string_agg(complete::text, E'\\n' ORDER BY complete::text),'')) AS "completeHash"
      FROM (SELECT to_jsonb(t)-'tenant_id' AS value, to_jsonb(t) AS complete FROM public."${tablename}" t) r`)
    ).rows[0];
  }
  return result;
}

export async function inspectExpansion({ connectionString } = {}) {
  const client = new Client({
    connectionString: explicitConnection(connectionString),
    connectionTimeoutMillis: 10000,
    application_name: "single-store-read-only-expansion-verifier",
  });
  const report = {
    formatVersion: 1,
    mode: "report-only",
    ready: false,
    transaction: null,
    contracts: {},
    fingerprints: {},
  };
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL row_security = off");
    await client.query("SET LOCAL search_path = pg_catalog");
    report.transaction = (
      await client.query(`SELECT current_setting('transaction_read_only')='on' AS "readOnly",
      current_setting('transaction_isolation') AS isolation`)
    ).rows[0];
    for (const [name, signature, serviceEntry] of CONTRACTS) {
      report.contracts[name] = await contract(client, signature, serviceEntry);
    }
    report.fingerprints = await fingerprints(client);
    report.ready = Object.values(report.contracts).every((item) => item.ready);
    return report;
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* No transaction after a failed connection. */
    }
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--compare"))
      throw new Error("invalid_arguments");
    const report = await inspectExpansion({
      connectionString: process.env.SINGLE_STORE_DATABASE_URL,
    });
    if (args.length) {
      const prior = JSON.parse(await readFile(args[1], "utf8"));
      report.preservationMatches =
        JSON.stringify(prior.fingerprints) === JSON.stringify(report.fingerprints);
      report.ready = report.ready && report.preservationMatches;
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ready ? 0 : 1;
  } catch (error) {
    const allowed = [
      "explicit_connection_url_required",
      "invalid_connection_url",
      "invalid_arguments",
    ];
    process.stdout.write(
      `${JSON.stringify({
        ready: false,
        mode: "report-only",
        error: allowed.includes(error.message)
          ? error.message
          : "expansion_verification_failed",
      })}\n`,
    );
    process.exitCode = 2;
  }
}
