import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TABLES = [
  "checkout_notification_outbox",
  "email_audit_log",
  "featured_items",
  "inventory_reservations",
  "orders",
  "payment_transactions",
  "product_variants",
  "products",
  "profiles",
  "shipping_defaults",
  "shipping_profiles",
  "square_disputes",
  "square_refunds",
  "state_sales_tracking",
  "tag_aliases",
  "tag_brands",
  "tag_candidates",
  "tag_models",
  "tag_sizes",
  "tenant_store_access_settings",
];
const REQUIRED = {
  tenants: { id: "uuid" },
  tag_brands: { id: "uuid", canonical_label: "text" },
  tag_models: { brand_id: "uuid", canonical_label: "text" },
  tag_aliases: { entity_type: "text", alias_normalized: "text" },
  tag_sizes: { size_type: "text", canonical_label: "text" },
  product_variants: { sku: "text", product_id: "uuid", size_id: "uuid" },
  featured_items: { product_id: "uuid" },
  shipping_defaults: { category: "text" },
  state_sales_tracking: {
    state_code: "character varying(2)",
    year: "integer",
    month: "integer",
  },
  tenant_store_access_settings: {
    site_lock_enabled: "boolean",
    site_unlock_at: "timestamp with time zone",
    checkout_lock_enabled: "boolean",
    checkout_lock_message: "text",
  },
  orders: {
    status: "text",
    expires_at: "timestamp with time zone",
    cart_hash: "text",
    square_order_id: "text",
  },
  inventory_reservations: { status: "text", expires_at: "timestamp with time zone" },
  checkout_notification_outbox: {
    status: "text",
    next_attempt_at: "timestamp with time zone",
    updated_at: "timestamp with time zone",
  },
  square_refunds: { square_refund_id: "text", status: "text" },
  square_disputes: { square_dispute_id: "text", state: "text" },
};
const NORMAL = (column) => `lower(${column})`;
// All SQL fragments and identifiers below are source constants, never row values.
const COLLISIONS = [
  [
    "variant_sku",
    "product_variants.sku",
    "public.product_variants",
    "sku",
    "sku IS NOT NULL",
  ],
  [
    "variant_product_size",
    "product_variants.product_id product_variants.size_id",
    "public.product_variants",
    "product_id, size_id",
    "product_id IS NOT NULL AND size_id IS NOT NULL",
  ],
  [
    "featured_product",
    "featured_items.product_id",
    "public.featured_items",
    "product_id",
    "product_id IS NOT NULL",
  ],
  [
    "shipping_category",
    "shipping_defaults.category",
    "public.shipping_defaults",
    "category",
    "category IS NOT NULL",
  ],
  [
    "brand_name",
    "tag_brands.canonical_label",
    "public.tag_brands",
    NORMAL("canonical_label"),
    "canonical_label IS NOT NULL",
  ],
  [
    "model_within_brand",
    "tag_models.brand_id tag_models.canonical_label tag_brands.id tag_brands.canonical_label",
    "public.tag_models m JOIN public.tag_brands b ON b.id = m.brand_id",
    `${NORMAL("b.canonical_label")}, ${NORMAL("m.canonical_label")}`,
    "b.canonical_label IS NOT NULL AND m.canonical_label IS NOT NULL",
  ],
  [
    "alias_value",
    "tag_aliases.entity_type tag_aliases.alias_normalized",
    "public.tag_aliases",
    "entity_type, alias_normalized",
    "entity_type IS NOT NULL AND alias_normalized IS NOT NULL",
  ],
  [
    "size_name",
    "tag_sizes.size_type tag_sizes.canonical_label",
    "public.tag_sizes",
    `size_type, ${NORMAL("canonical_label")}`,
    "size_type IS NOT NULL AND canonical_label IS NOT NULL",
  ],
  [
    "sales_period",
    "state_sales_tracking.state_code state_sales_tracking.year state_sales_tracking.month",
    "public.state_sales_tracking",
    "state_code, year, month",
    "state_code IS NOT NULL AND year IS NOT NULL AND month IS NOT NULL",
  ],
];
const PENDING = {
  orders: [
    "orders",
    "status expires_at cart_hash square_order_id",
    `
    count(*)::integer AS rows,
    count(*) FILTER (WHERE status = 'pending')::integer AS pending,
    count(*) FILTER (WHERE status = 'pending' AND expires_at <= now())::integer AS "expiredPending",
    count(*) FILTER (WHERE status IN ('review','blocked','payment_pending','refund_pending'))::integer AS "requiresReconciliation",
    count(*) FILTER (WHERE status = 'pending' AND cart_hash IS NOT NULL)::integer AS "pendingWithCartHash",
    count(*) FILTER (WHERE status = 'pending' AND square_order_id IS NOT NULL)::integer AS "pendingWithProviderOrder"`,
  ],
  inventoryReservations: [
    "inventory_reservations",
    "status expires_at",
    `
    count(*)::integer AS rows,
    count(*) FILTER (WHERE status = 'active')::integer AS active,
    count(*) FILTER (WHERE status = 'active' AND expires_at <= now())::integer AS "expiredActive"`,
  ],
  outbox: [
    "checkout_notification_outbox",
    "status next_attempt_at updated_at",
    `
    count(*)::integer AS rows,
    count(*) FILTER (WHERE status = 'pending')::integer AS pending,
    count(*) FILTER (WHERE status = 'failed')::integer AS failed,
    count(*) FILTER (WHERE status = 'processing')::integer AS processing,
    count(*) FILTER (WHERE status = 'sent')::integer AS sent,
    count(*) FILTER (WHERE status IN ('pending','failed') AND next_attempt_at <= now())::integer AS due,
    count(*) FILTER (WHERE status = 'processing' AND updated_at <= now()-interval '10 minutes')::integer AS "staleProcessing"`,
  ],
  refunds: [
    "square_refunds",
    "status",
    `count(*)::integer AS rows, count(*) FILTER (WHERE upper(status) = 'PENDING')::integer AS pending`,
  ],
  disputes: [
    "square_disputes",
    "state",
    `count(*)::integer AS rows, count(*) FILTER (WHERE upper(state) NOT IN ('WON','LOST','ACCEPTED'))::integer AS "notFinal"`,
  ],
};

function committedBaseline(through) {
  const files = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", "HEAD", "--", "supabase/migrations"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
    .trim()
    .split(/\r?\n/)
    .filter((file) => /\/\d{14}_.+\.sql$/.test(file));
  const versions = files.map((file) => file.split("/").at(-1).slice(0, 14)).sort();
  if (!versions.length || new Set(versions).size !== versions.length) {
    throw new Error("invalid_committed_migration_inventory");
  }
  if (through && !versions.includes(through)) {
    throw new Error("unknown_baseline_cutoff");
  }
  return versions.filter((version) => !through || version <= through);
}

function validateConnection(connectionString) {
  if (!connectionString) {
    throw new Error("explicit_connection_url_required");
  }
  let url;
  try {
    url = new URL(connectionString);
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
}

function inspectRetainedSchema(catalogColumns) {
  const tableColumns = catalogColumns.filter(
    (column) => column.nspname === "public" && ["r", "p"].includes(column.relkind),
  );
  const columns = new Map(
    tableColumns.map((column) => [
      `${column.relname}.${column.attname}`,
      column.data_type,
    ]),
  );
  const presentTables = new Set(tableColumns.map((column) => column.relname));
  const tenantRelations = catalogColumns.filter(
    (column) => column.nspname === "public" && column.attname === "tenant_id",
  );
  const schema = {
    expectedTenantTableCount: TABLES.length,
    actualTenantTableCount: tenantRelations.length,
    unexpectedTenantTableCount: tenantRelations.filter(
      (column) =>
        !TABLES.includes(column.relname) || !["r", "p"].includes(column.relkind),
    ).length,
    missingTables: ["tenants", ...TABLES].filter((table) => !presentTables.has(table)),
    missingColumns: [],
    incompatibleColumns: [],
  };
  const required = Object.fromEntries(
    TABLES.map((table) => [table, { tenant_id: "uuid", ...REQUIRED[table] }]),
  );
  required.tenants = REQUIRED.tenants;
  for (const [table, fields] of Object.entries(required)) {
    for (const [field, type] of Object.entries(fields)) {
      const key = `${table}.${field}`;
      if (!columns.has(key)) {
        schema.missingColumns.push(key);
      } else if (columns.get(key) !== type) {
        schema.incompatibleColumns.push(key);
      }
    }
  }
  const available = (keys) =>
    keys
      .split(" ")
      .every((key) => columns.has(key) && !schema.incompatibleColumns.includes(key));
  return { schema, available };
}

async function inspectMigrationBaseline(query, catalogColumns, expectedVersions) {
  const registryPresent = catalogColumns.some(
    (column) =>
      column.nspname === "supabase_migrations" &&
      column.relname === "schema_migrations" &&
      column.attname === "version" &&
      ["r", "p"].includes(column.relkind),
  );
  const migrationRows = registryPresent
    ? await query(
        "migration_registry",
        "SELECT version::text AS version FROM supabase_migrations.schema_migrations",
      )
    : null;
  const recorded = migrationRows?.map((row) => row.version) ?? [];
  const valid = recorded.filter((version) => /^\d{14}$/.test(version));
  const missing = expectedVersions.filter((version) => !valid.includes(version));
  return {
    through: expectedVersions.at(-1),
    expectedCount: expectedVersions.length,
    recordedCount: migrationRows ? recorded.length : null,
    missingVersions: missing,
    unexpectedVersionCount: valid.filter((version) => !expectedVersions.includes(version))
      .length,
    invalidVersionCount: recorded.length - valid.length,
    duplicateVersionCount: valid.length - new Set(valid).size,
    matches:
      Boolean(migrationRows) &&
      missing.length === 0 &&
      valid.length === recorded.length &&
      valid.length === expectedVersions.length &&
      new Set(valid).size === valid.length,
  };
}

async function inspectTableOwnership(query, available, table) {
  if (!available(`${table}.tenant_id`)) {
    return null;
  }
  const orphanSql = available("tenants.id")
    ? `count(*) FILTER (WHERE t.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants owner WHERE owner.id = t.tenant_id))::integer`
    : "NULL::integer";
  const rows = await query(
    `ownership.${table}`,
    `SELECT count(*)::integer AS rows, count(*) FILTER (WHERE tenant_id IS NULL)::integer AS "globalRows", count(DISTINCT tenant_id)::integer AS "distinctOwners", ${orphanSql} AS "unregisteredOwnerRows" FROM public.${table} t`,
  );
  return rows?.[0] ?? null;
}

async function countDistinctOwners(query, ownerUnions) {
  if (!ownerUnions.length) {
    return null;
  }
  const rows = await query(
    "ownership.distinct",
    `SELECT count(DISTINCT tenant_id)::integer AS count FROM (${ownerUnions.join(" UNION ALL ")}) owners`,
  );
  return rows?.[0]?.count ?? null;
}

async function inspectOwnership(query, available) {
  const tenantRows = available("tenants.id")
    ? ((
        await query("tenant_rows", "SELECT count(*)::integer AS rows FROM public.tenants")
      )?.[0]?.rows ?? null)
    : null;
  const ownership = {
    tenantRows,
    distinctOwners: null,
    unregisteredOwnerRows: 0,
    globalRows: 0,
    tables: {},
  };
  const ownerUnions = [];
  for (const table of TABLES) {
    const counts = await inspectTableOwnership(query, available, table);
    ownership.tables[table] = counts;
    if (counts) {
      ownership.globalRows += counts.globalRows;
      ownership.unregisteredOwnerRows += counts.unregisteredOwnerRows ?? 0;
      ownerUnions.push(
        `SELECT tenant_id FROM public.${table} WHERE tenant_id IS NOT NULL`,
      );
    }
  }
  if (
    Object.values(ownership.tables).some(
      (counts) => counts === null || counts.unregisteredOwnerRows === null,
    )
  ) {
    ownership.globalRows = null;
    ownership.unregisteredOwnerRows = null;
    return ownership;
  }
  ownership.distinctOwners = await countDistinctOwners(query, ownerUnions);
  return ownership;
}

async function inspectCollisions(query, available) {
  const collisions = {};
  for (const [name, fields, from, keys, where] of COLLISIONS) {
    collisions[name] = available(fields)
      ? ((
          await query(
            `collision.${name}`,
            `SELECT count(*)::integer AS groups, coalesce(sum(n),0)::integer AS rows FROM (SELECT count(*) AS n FROM ${from} WHERE ${where} GROUP BY ${keys} HAVING count(*) > 1) collisions`,
          )
        )?.[0] ?? null)
      : null;
  }
  return collisions;
}

async function inspectStoreSettings(query, available) {
  const fields = Object.keys(REQUIRED.tenant_store_access_settings);
  if (
    !available(fields.map((field) => `tenant_store_access_settings.${field}`).join(" "))
  ) {
    return null;
  }
  return (
    (
      await query(
        "store_settings",
        `SELECT count(*)::integer AS rows, count(DISTINCT ROW(${fields.join(",")}))::integer AS "distinctConfigurations" FROM public.tenant_store_access_settings`,
      )
    )?.[0] ?? null
  );
}

async function inspectPendingWork(query, available) {
  const pendingWork = {};
  for (const [name, [table, fields, projection]] of Object.entries(PENDING)) {
    pendingWork[name] = available(
      fields
        .split(" ")
        .map((field) => `${table}.${field}`)
        .join(" "),
    )
      ? ((
          await query(`pending_work.${name}`, `SELECT ${projection} FROM public.${table}`)
        )?.[0] ?? null)
      : null;
  }
  return pendingWork;
}

function recordSchemaBlockers(report, block) {
  if (
    report.schema.unexpectedTenantTableCount ||
    report.schema.missingTables.length ||
    report.schema.missingColumns.length ||
    report.schema.incompatibleColumns.length
  ) {
    block("schema_gap", "retained_table_inventory");
  }
  if (!report.baseline.matches) {
    block("migration_baseline", "committed_versions");
  }
}

function recordOwnershipAndCollisionBlockers(report, block) {
  if (report.ownership.tenantRows !== 1) {
    block("tenant_cardinality", "tenants");
  }
  if (report.ownership.distinctOwners > 1) {
    block("multiple_owners", "all_retained_references");
  }
  if (report.ownership.unregisteredOwnerRows > 0) {
    block("unregistered_owner", "all_retained_references");
  }
  for (const [name, counts] of Object.entries(report.collisions)) {
    if (counts?.groups > 0) {
      block("canonical_collision", name);
    }
  }
}

export async function inspectDatabase({ connectionString, baselineThrough } = {}) {
  validateConnection(connectionString);
  const expectedVersions = committedBaseline(baselineThrough);
  const catalogSql = await readFile(new URL("preflight.sql", import.meta.url), "utf8");
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    application_name: "single-store-report-only-preflight",
  });
  const report = {
    formatVersion: 1,
    mode: "report-only",
    ready: false,
    blockers: [],
    transaction: null,
    baseline: null,
    schema: null,
    ownership: null,
    collisions: {},
    storeSettings: null,
    dependencies: null,
    pendingWork: {},
  };
  const block = (code, check) => {
    if (!report.blockers.some((item) => item.code === code && item.check === check)) {
      report.blockers.push({ code, check });
    }
  };
  // Per-check savepoints let a denied/missing/changed object block readiness
  // without discarding other safe diagnostics in this same consistent snapshot.
  const query = async (check, sql, values = []) => {
    await client.query("SAVEPOINT preflight_check");
    try {
      const result = await client.query(sql, values);
      await client.query("RELEASE SAVEPOINT preflight_check");
      return result.rows;
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT preflight_check");
      await client.query("RELEASE SAVEPOINT preflight_check");
      block("incomplete_check", check);
      return null;
    }
  };
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    // Fail on an RLS-filtered read instead of reporting misleading partial data.
    await client.query("SET LOCAL row_security = off");
    await client.query("SET LOCAL search_path = pg_catalog");
    const catalog = (await query("catalog", catalogSql))?.[0]?.report;
    if (!catalog) {
      return report;
    }
    report.transaction = catalog.transaction;
    report.dependencies = catalog.dependencies;
    const { schema, available } = inspectRetainedSchema(catalog.columns);
    report.schema = schema;
    report.baseline = await inspectMigrationBaseline(
      query,
      catalog.columns,
      expectedVersions,
    );
    recordSchemaBlockers(report, block);
    report.ownership = await inspectOwnership(query, available);
    report.collisions = await inspectCollisions(query, available);
    recordOwnershipAndCollisionBlockers(report, block);
    report.storeSettings = await inspectStoreSettings(query, available);
    if (report.storeSettings?.rows > 1) {
      block("settings_cardinality", "store_settings");
    }
    if (report.storeSettings?.distinctConfigurations > 1) {
      block("settings_conflict", "store_settings");
    }
    report.pendingWork = await inspectPendingWork(query, available);
    report.ready = report.blockers.length === 0;
    return report;
  } finally {
    // Successful reports also ROLLBACK: the command cannot apply a migration,
    // create fixtures, repair the baseline or choose/reassign an owner.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* No open transaction after a failed connection. */
    }
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length &&
      (args.length !== 2 || args[0] !== "--baseline-through" || !/^\d{14}$/.test(args[1]))
    ) {
      throw new Error("invalid_arguments");
    }
    const result = await inspectDatabase({
      connectionString: process.env.SINGLE_STORE_DATABASE_URL,
      baselineThrough: args[1],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ready ? 0 : 1;
  } catch (error) {
    const safeErrors = [
      "explicit_connection_url_required",
      "invalid_connection_url",
      "invalid_arguments",
      "unknown_baseline_cutoff",
      "invalid_committed_migration_inventory",
    ];
    const code = safeErrors.includes(error.message) ? error.message : "preflight_failed";
    process.stdout.write(
      `${JSON.stringify({ formatVersion: 1, mode: "report-only", ready: false, error: code })}\n`,
    );
    process.exitCode = 2;
  }
}
