import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client } from "pg";
import payloads from "../../src/Modules/Analytics/Tests/Features/CommerceFacts/payloads.json" with { type: "json" };
import { validatePrefix } from "../../scripts/single-store/check-migration-baseline.mjs";
import { testReportingHistory } from "../../scripts/test-admin-analytics-history.mjs";
import {
  root,
  validateMutationTarget,
  withCheckoutProject,
} from "./fixtures/checkout-hardening.mjs";

const shippingThrough = "20261127034000";
const bootstrapVersion = "20261127134000";
const recoveryBindingVersion = "20261127195500";

async function readCanonicalMigrations() {
  const directory = join(root, "supabase", "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (file) => {
      const [, version, name] = /^(\d{14})_(.+)\.sql$/.exec(file);
      return { version, name, source: await readFile(join(directory, file), "utf8") };
    }),
  );
}

async function assertCanonicalLedger(admin, expected) {
  const { rows } = await admin.query(
    "select version, name, statements[1] as source from supabase_migrations.schema_migrations order by version",
  );
  assert.equal(
    rows.length,
    expected.length,
    "The complete migration ledger must remain intact",
  );
  assert.deepEqual(
    rows,
    expected,
    "Every recorded migration must retain its canonical SQL",
  );
  assert.deepEqual(
    validatePrefix(
      expected.map(({ version }) => version),
      rows.map(({ version }) => version),
    ),
    { blockers: [], through: expected.at(-1).version },
    "Reconciliation must restore the strict canonical migration prefix",
  );
}

async function assertReportingExports(admin) {
  const bootstrap = (
    await admin.query(
      "select environment, initialized_at from analytics_source.reporting_schema_bootstrap order by environment",
    )
  ).rows;
  assert.deepEqual(
    bootstrap.map(({ environment }) => environment),
    ["production", "staging"],
  );
  assert.ok(bootstrap.every(({ initialized_at }) => initialized_at instanceof Date));
  await admin.query("begin");
  try {
    for (const environment of ["staging", "production"]) {
      const datasetId = "sole-" + environment;
      const orderId =
        environment === "staging"
          ? "11111111-1111-4111-8111-111111111111"
          : "22222222-2222-4222-8222-222222222222";
      const receiptId =
        environment === "staging"
          ? "33333333-3333-4333-8333-333333333333"
          : "44444444-4444-4444-8444-444444444444";
      await admin.query(
        "insert into public.analytics_datasets(dataset_id,environment,activated_at) values($1,$2,'2018-01-01')",
        [datasetId, environment],
      );
      await admin.query(
        "insert into public.analytics_consent_receipts(dataset_id,receipt_id,granted_at) values($1,$2,'2018-01-01')",
        [datasetId, receiptId],
      );
      await admin.query(
        "insert into public.analytics_order_context(dataset_id,order_id,line_snapshots,receipt_id,visitor_id,session_id,device) values($1,$2,'[]',$3,$4::text,$4::uuid,'desktop')",
        [datasetId, orderId, receiptId, orderId],
      );
      for (const revision of [1, 3, 2]) {
        await admin.query("select public.analytics_append_fact($1)", [
          {
            datasetId,
            factId: "order:" + orderId,
            orderId,
            revision,
            kind: "order",
            effectiveAt: "2018-01-02T05:00:00Z",
            recordedAt: "2018-01-02T05:00:00Z",
            buyerKey: "sole-buyer:v1:" + "a".repeat(64),
            currency: "USD",
            payload: payloads.order,
          },
        ]);
      }
    }
    for (const environment of ["staging", "production"]) {
      const role = "sole_analytics_" + environment + "_reader";
      assert.equal(
        (
          await admin.query(
            "select has_table_privilege($1,'analytics_source.reporting_schema_bootstrap','select') as allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
        "Bootstrap source rows must stay private",
      );
      await admin.query("set local role " + role);
      const financial = (
        await admin.query(
          "select dataset_id, environment, kind, revision, payload from analytics_reporting.analytics_financial_export order by dataset_id",
        )
      ).rows;
      assert.deepEqual(
        financial,
        [
          {
            dataset_id: "__analytics_schema_bootstrap_" + environment + "__",
            environment,
            kind: "__schema_bootstrap__",
            revision: 1,
            payload: {},
          },
          {
            dataset_id: "sole-" + environment,
            environment,
            kind: "order",
            revision: 3,
            payload: payloads.order,
          },
        ],
        "Each reader must retain its own bootstrap and latest real financial fact",
      );
      assert.deepEqual(
        (
          await admin.query(
            "select dataset_id, active from analytics_reporting.analytics_purchase_link_export order by dataset_id",
          )
        ).rows,
        [
          {
            dataset_id: "__analytics_schema_bootstrap_" + environment + "__",
            active: false,
          },
          { dataset_id: "sole-" + environment, active: true },
        ],
        "Schema metadata must remain separate from application purchase links",
      );
      await admin.query("reset role");
    }
    assert.deepEqual(
      (
        await admin.query(
          "select environment, initialized_at from analytics_source.reporting_schema_bootstrap order by environment",
        )
      ).rows,
      bootstrap,
      "Reporting must preserve bootstrap cursor timestamps",
    );
  } finally {
    await admin.query("rollback");
  }
}

async function withReportingAdmin(fixture, runTest) {
  const lease = JSON.parse(fixture.childEnv.CHECKOUT_HARDENING_DB_LEASE);
  const url = validateMutationTarget(lease.url, lease);
  // The platform's fixture administrator can SET ROLE to the nologin readers.
  // The application postgres role intentionally has no reader memberships.
  url.username = "supabase_admin";
  const client = new Client({
    connectionString: url.href,
    connectionTimeoutMillis: 5000,
    statement_timeout: 60000,
  });
  await client.connect();
  try {
    assert.deepEqual(
      (
        await client.query(
          "select current_database() as database, current_user as role, token, schema_hash as schema from checkout_hardening_fixture.ownership",
        )
      ).rows,
      [
        {
          database: lease.database,
          role: "supabase_admin",
          token: lease.ownership.token,
          schema: lease.schema,
        },
      ],
      "Reporting administrator must use this exact owned mutation database",
    );
    await runTest(client);
  } finally {
    await client.end();
  }
}

for (const mode of ["fresh", "populated"]) {
  for (const bootstrapBeforeCheckout of [true, false]) {
    const order = bootstrapBeforeCheckout
      ? "bootstrap before checkout"
      : "canonical order";
    test(
      `${mode}: ${order} preserves the canonical migration ledger and reporting`,
      { timeout: 240_000 },
      async () => {
        const expected = await readCanonicalMigrations();
        assert.ok(
          expected.some(({ version }) => version === recoveryBindingVersion),
          "Canonical inventory must include the checkout decline inquiry binding",
        );
        const resources = [];
        await withCheckoutProject(
          mode,
          async (fixture) => {
            assert.equal(fixture.migrations, expected.length);
            if (bootstrapBeforeCheckout) {
              const shippingVersions = expected
                .filter(({ version }) => version <= shippingThrough)
                .map(({ version }) => version);
              assert.equal(shippingVersions.at(-1), shippingThrough);
              assert.deepEqual(
                fixture.preCheckoutVersions,
                [...shippingVersions, bootstrapVersion],
                "Bootstrap-first replay must start with the shipping prefix and the recorded bootstrap",
              );
            }
            await fixture.withDatabase(async ({ admin, populated }) => {
              await assertCanonicalLedger(admin, expected);
              for (const table of [
                "checkout_payment_attempts",
                "checkout_payment_attempt_history",
                "checkout_financial_facts",
              ]) {
                assert.equal(
                  (
                    await admin.query("select to_regclass($1)::text as name", [
                      "public." + table,
                    ])
                  ).rows[0].name,
                  table,
                );
              }
              assert.equal(
                (
                  await admin.query(
                    "select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reserve_checkout_inventory_v2_with_analytics','apply_checkout_payment_with_analytics')",
                  )
                ).rows[0].n,
                2,
                "Checkout and analytics integration functions must both exist",
              );
              if (mode === "populated") {
                assert.deepEqual(
                  (
                    await admin.query(
                      "select o.status, o.total::text, v.stock from orders o cross join product_variants v where o.id=$1 and v.id=$2",
                      [populated.orderId, populated.variantId],
                    )
                  ).rows,
                  [{ status: "paid", total: "19.87", stock: 3 }],
                );
                assert.equal(
                  (
                    await admin.query(
                      "select checkout_financial_review from public.orders where id=$1",
                      [populated.legacyReview.orderId],
                    )
                  ).rows[0].checkout_financial_review,
                  "square_payment_high_risk",
                );
              }
              await withReportingAdmin(fixture, assertReportingExports);
              if (mode === "fresh" && bootstrapBeforeCheckout) {
                await withReportingAdmin(fixture, testReportingHistory);
              }
              await assertCanonicalLedger(admin, expected);
            });
          },
          {
            bootstrapBeforeCheckout,
            onResourceReceipt: (receipt) => resources.push(receipt),
          },
        );
        const created = resources.filter(({ phase }) => phase === "before");
        assert.ok(
          created.some(({ kind }) => kind === "container"),
          "Rehearsal must own a real PostgreSQL container",
        );
        for (const resource of created) {
          assert.ok(
            resources.some(
              ({ phase, kind, id, name, present }) =>
                phase === "after" &&
                kind === resource.kind &&
                id === resource.id &&
                name === resource.name &&
                present === false,
            ),
            "Every owned Docker resource must have a verified cleanup receipt",
          );
        }
      },
    );
  }
}
