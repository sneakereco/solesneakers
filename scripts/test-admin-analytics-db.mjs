import { testCommerceSources } from "./test-admin-analytics-sources.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import scalarSchemas from "../src/Modules/Analytics/Source/Features/CommerceFacts/fact-scalar-schemas.json" with { type: "json" };
import factParity from "../src/Modules/Analytics/Tests/Features/CommerceFacts/fact-parity.json" with { type: "json" };
import payloads from "../src/Modules/Analytics/Tests/Features/CommerceFacts/payloads.json" with { type: "json" };

// This runner commits fixture jobs to test independent sessions. Never accept a remote
// endpoint, URL parameters/overrides, or a shared local application database.
const fixturePath = new URL(
  "../.superpowers/sdd/2026-11-25-admin-analytics/database.json",
  import.meta.url,
);
const connectionString =
  process.env.ANALYTICS_TEST_DATABASE_URL ??
  JSON.parse(readFileSync(fixturePath, "utf8").replace(/^\uFEFF/, "")).url;
const url = new URL(connectionString);
assert(
  ["postgresql:", "postgres:"].includes(url.protocol) &&
    url.hostname === "127.0.0.1" &&
    url.port === "60279" &&
    url.pathname === "/admin_analytics_sdd" &&
    url.username === "supabase_admin" &&
    !url.search &&
    !url.hash,
  "Expected the isolated loopback admin analytics fixture",
);
const db = new Client({ connectionString, statement_timeout: 5000 });
const worker = new Client({ connectionString, statement_timeout: 5000 });
const ds = "test-" + randomUUID();
const otherDataset = "test-" + randomUUID();
const orderId = randomUUID();
const timestamp = new Date().toISOString();
const fact = {
  datasetId: ds,
  factId: orderId,
  revision: 1,
  kind: "order",
  effectiveAt: timestamp,
  recordedAt: timestamp,
  currency: "USD",
  buyerKey: null,
  orderId,
  payload: {
    grossMerchandiseCents: 100,
    discountCents: 0,
    merchandiseCents: 100,
    shippingCents: 0,
    taxCents: 0,
    totalCollectedCents: 100,
    paymentMethod: "card",
    fulfillment: "ship",
    status: "paid",
  },
};
const append = (candidate = fact) =>
  db
    .query("select public.analytics_append_fact($1) as id", [candidate])
    .then((result) => result.rows[0].id);
const claim = (client = db, dataset = ds) =>
  client
    .query("select * from public.analytics_claim_publications($1,1,30)", [dataset])
    .then((result) => result.rows);
const complete = (id, token, dataset = ds) =>
  db
    .query("select public.analytics_complete_publication($1,$2,$3) as ok", [
      dataset,
      id,
      token,
    ])
    .then((result) => result.rows[0].ok);
const expire = (id) =>
  db.query(
    "update public.analytics_publication_outbox set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
    [id],
  );
const qualifiedTables = [
  "analytics_datasets",
  "analytics_order_context",
  "analytics_fact_versions",
  "analytics_publication_outbox",
  "analytics_consent_receipts",
];
let created = false;

try {
  await db.connect();
  await worker.connect();
  assert.deepEqual(
    (await db.query("select current_database() as db,current_user as owner")).rows[0],
    { db: "admin_analytics_sdd", owner: "supabase_admin" },
  );
  assert.equal(
    (
      await db.query(
        "select to_regprocedure(\'public.reserve_square_checkout_inventory_with_analytics(jsonb,jsonb)\') is not null as installed",
      )
    ).rows[0].installed,
    true,
    "analytics reservation wrapper installed",
  );
  assert(
    (await db.query("select pg_try_advisory_lock(25111800) as locked")).rows[0].locked,
    "another fixture runner is active",
  );
  await testCommerceSources(db, worker);
  await db.query(
    "insert into public.analytics_datasets(dataset_id,environment,activated_at) values ($1,'staging',$2)",
    [ds, "2000-01-01T00:00:00Z"],
  );
  created = true;
  await db.query(
    "insert into public.analytics_datasets(dataset_id,environment,activated_at) values ($1,'production',$2)",
    [otherDataset, timestamp],
  );
  await db.query("create temporary table source_probe(id uuid)");
  await db.query("begin");
  await db.query("insert into source_probe values ($1)", [orderId]);
  await append();
  await db.query("rollback");
  for (const table of [
    "source_probe",
    "public.analytics_fact_versions",
    "public.analytics_publication_outbox",
  ]) {
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from " +
            table +
            (table === "source_probe" ? "" : " where dataset_id=$1"),
          table === "source_probe" ? [] : [ds],
        )
      ).rows[0].n,
      0,
    );
  }
  console.log("PASS source, fact version and publication roll back together");
  await db.query("begin");
  for (const [kind, payload] of Object.entries(payloads)) {
    await append({ ...fact, kind, payload, factId: randomUUID() });
  }
  await db.query("rollback");
  console.log("PASS all ten fact kinds pass the SQL payload contract");
  assert.deepEqual(
    (await db.query("select public.analytics_fact_scalar_schemas() as schemas")).rows[0]
      .schemas,
    scalarSchemas,
  );
  for (const entry of factParity) {
    const candidate = {
      ...fact,
      kind: entry.kind,
      factId: randomUUID(),
      payload: payloads[entry.kind],
    };
    if (entry.top) candidate[entry.key] = entry.value;
    else candidate.payload = { ...candidate.payload, [entry.key]: entry.value };
    await db.query("begin");
    try {
      if (entry.valid) {
        const publication = await append(candidate);
        const [row] = await claim();
        assert.equal(row.publication_id, publication, entry.name);
        assert.deepEqual(row.fact, candidate, entry.name);
      } else {
        await assert.rejects(append(candidate), { code: "23514" }, entry.name);
      }
    } finally {
      await db.query("rollback");
    }
    if (entry.key === "productName") {
      const result = await db.query(
        "select public.analytics_snapshot_catalog_label($1) as label",
        [entry.value],
      );
      assert.equal(result.rows[0].label, entry.valid ? entry.value : null, entry.name);
    }
  }
  console.log(
    "PASS shared application/SQL/claim parity matrix, completed refunds and safe catalog snapshots",
  );
  await db.query("set role service_role");
  const receipt = (
    await db.query(
      "insert into public.analytics_consent_receipts(dataset_id) values ($1) returning receipt_id",
      [ds],
    )
  ).rows[0].receipt_id;
  const buyerKey = "sole-buyer:v1:" + "a".repeat(64);
  const groupOrder = randomUUID();
  await db.query(
    "insert into public.analytics_order_context(dataset_id,order_id,line_snapshots,receipt_id,visitor_id,session_id,device,discovery) values($1,$2,$3,$4,$5,$6,'desktop',$7)",
    [
      ds,
      groupOrder,
      JSON.stringify([payloads.line]),
      receipt,
      buyerKey,
      randomUUID(),
      { source: "google" },
    ],
  );
  const authorized = () =>
    db.query(
      "select c.tracked_publication_id from public.analytics_order_context c join public.analytics_consent_receipts r using(dataset_id,receipt_id) where c.dataset_id=$1 and c.order_id=$2 and r.revoked_at is null",
      [ds, groupOrder],
    );
  assert.equal((await authorized()).rowCount, 1);
  assert.equal(
    (await db.query("select public.analytics_revoke_receipt($1,$2) as ok", [ds, receipt]))
      .rows[0].ok,
    true,
  );
  assert.equal((await authorized()).rowCount, 0);
  await assert.rejects(
    db.query(
      "update public.analytics_consent_receipts set revoked_at=null where receipt_id=$1",
      [receipt],
    ),
    { code: "42501" },
  );
  await assert.rejects(
    db.query(
      "update public.analytics_order_context set receipt_id=null where order_id=$1",
      [groupOrder],
    ),
    { code: "42501" },
  );
  await db.query("reset role");
  console.log(
    "PASS immutable order context, identified visitor correlation and one-way consent revocation",
  );
  // A service-role caller journals through the restricted append API.
  await db.query("set role service_role");
  await assert.rejects(
    append({
      ...fact,
      kind: "line",
      factId: randomUUID(),
      payload: { ...payloads.line, productName: "Shop (212) 555-0123" },
    }),
    { code: "23514" },
  );
  const [publication, racingReplay] = await Promise.all([
    append(),
    worker
      .query("select public.analytics_append_fact($1) as id", [fact])
      .then((result) => result.rows[0].id),
  ]);
  assert.equal(racingReplay, publication);
  assert.equal(await append(), publication);
  await assert.rejects(
    append({ ...fact, payload: { ...fact.payload, discountCents: 1 } }),
    { code: "23505" },
  );
  await assert.rejects(
    append({
      ...fact,
      revision: 2,
      payload: { ...fact.payload, email: "buyer@example.com" },
    }),
    { code: "23514" },
  );
  await assert.rejects(
    append({
      ...fact,
      revision: 2,
      payload: { ...fact.payload, taxCents: 9007199254740992 },
    }),
    { code: "23514" },
  );
  await db.query("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.analytics_publication_outbox where dataset_id=$1",
        [ds],
      )
    ).rows[0].n,
    1,
  );
  console.log("PASS identical replay, conflict detection and SQL payload constraints");
  await db.query("begin");
  const [leased] = await claim();
  assert.equal(leased.publication_id, publication);
  assert.deepEqual(leased.fact, fact);
  assert.deepEqual(await claim(worker), []);
  await db.query("commit");
  assert.deepEqual(await claim(worker), []);
  await expire(publication);
  assert.equal(await complete(publication, leased.lease_token), false);
  const [reclaimed] = await claim(worker);
  assert.notEqual(reclaimed.lease_token, leased.lease_token);
  assert.equal(reclaimed.attempt, 2);
  assert.equal(await complete(publication, leased.lease_token), false);
  assert.equal(await complete(publication, reclaimed.lease_token), true);
  assert.deepEqual(await claim(), []);
  console.log(
    "PASS independent worker exclusion, expired lease reclamation and stale-token fencing",
  );
  const otherPublication = await append({ ...fact, datasetId: otherDataset });
  await worker.query("set role service_role");
  assert.deepEqual(await claim(), []);
  const [otherLease] = await claim(worker, otherDataset);
  assert.equal(otherLease.publication_id, otherPublication);
  assert.equal(otherLease.environment, "production");
  assert.equal(await complete(otherPublication, otherLease.lease_token), false);
  assert.equal(
    (
      await db.query(
        "select public.analytics_fail_publication($1,$2,$3,'network',true,0) as ok",
        [ds, otherPublication, otherLease.lease_token],
      )
    ).rows[0].ok,
    false,
  );
  assert.equal(
    await complete(otherPublication, otherLease.lease_token, otherDataset),
    true,
  );
  console.log(
    "PASS independent workers cannot claim, complete or fail another dataset's publications",
  );
  const second = await append({
    ...fact,
    revision: 2,
    recordedAt: new Date().toISOString(),
  });
  const [job] = await claim();
  const fail = (token, terminal) =>
    db
      .query("select public.analytics_fail_publication($1,$2,$3,'network',$4,60) as ok", [
        ds,
        second,
        token,
        terminal,
      ])
      .then((result) => result.rows[0].ok);
  assert.equal(await fail(job.lease_token, false), true);
  assert.deepEqual(await claim(), []);
  await db.query(
    "update public.analytics_publication_outbox set next_attempt_at=now() where id=$1",
    [second],
  );
  const [retry] = await claim();
  assert.equal(await fail(job.lease_token, true), false);
  assert.equal(await fail(retry.lease_token, true), true);
  assert.deepEqual(await claim(), []);
  console.log("PASS revision history, bounded retry scheduling and terminal failure");
  const third = await append({ ...fact, revision: 3 });
  const [lastJob] = await claim();
  assert.equal(lastJob.publication_id, third);
  await db.query(
    "update public.analytics_publication_outbox set attempts=8 where id=$1",
    [third],
  );
  await expire(third);
  assert.deepEqual(await claim(), []);
  assert.equal(
    (
      await db.query(
        "select status from public.analytics_publication_outbox where id=$1",
        [third],
      )
    ).rows[0].status,
    "failed",
  );
  console.log("PASS exhausted crashed lease becomes terminal");
  for (const role of ["anon", "authenticated"]) {
    await db.query("set role " + role);
    for (const table of qualifiedTables) {
      await assert.rejects(db.query("select * from public." + table + " limit 1"), {
        code: "42501",
      });
      await assert.rejects(db.query("insert into public." + table + " default values"), {
        code: "42501",
      });
      const flags = (
        await db.query(
          "select relrowsecurity as rls, has_table_privilege(current_user,oid,'UPDATE') as update_allowed, has_table_privilege(current_user,oid,'DELETE') as delete_allowed from pg_class where oid=$1::regclass",
          ["public." + table],
        )
      ).rows[0];
      assert.deepEqual(flags, {
        rls: true,
        update_allowed: false,
        delete_allowed: false,
      });
    }
    for (const [statement, values] of [
      ["select public.analytics_append_fact($1)", [fact]],
      ["select public.reserve_square_checkout_inventory_with_analytics($1,$2)", [{}, {}]],
      ["select public.analytics_record_operational_outcome($1,$2)", [ds, {}]],
      ["select analytics_source.dataset(now())", []],
      ["select public.analytics_revoke_receipt($1,$2)", [ds, orderId]],
      ["select * from public.analytics_claim_publications($1,1,1)", [ds]],
      ["select public.analytics_complete_publication($1,$2,$2)", [ds, orderId]],
      [
        "select public.analytics_fail_publication($1,$2,$2,'network',false,1)",
        [ds, orderId],
      ],
    ])
      await assert.rejects(db.query(statement, values), { code: "42501" });
    await db.query("reset role");
  }
  await db.query("set role service_role");
  await assert.rejects(
    db.query("delete from public.analytics_fact_versions where dataset_id=$1", [ds]),
    { code: "42501" },
  );
  await db.query("reset role");
  console.log(
    "PASS RLS enabled, table access and RPC execution denied to anon/authenticated",
  );
} finally {
  if (created) {
    await db.query("rollback");
    await db.query("reset role");
    for (const table of [
      "analytics_publication_outbox",
      "analytics_fact_versions",
      "analytics_order_context",
      "analytics_consent_receipts",
      "analytics_datasets",
    ])
      await db.query(
        "delete from public." + table + " where dataset_id=any($1::text[])",
        [[ds, otherDataset]],
      );
  }
  await Promise.all([db.end(), worker.end()]);
}
