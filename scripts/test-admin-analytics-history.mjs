import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import payloads from "../src/Modules/Analytics/Tests/Features/CommerceFacts/payloads.json" with { type: "json" };

export async function testReportingHistory(db) {
  await db.query("begin");
  try {
    const ds = "sole-staging",
      id = randomUUID(),
      session = randomUUID(),
      receipt = randomUUID();
    const environment = "staging";
    const t = "2018-01-02T05:00:00Z";
    await db.query(
      "insert into public.analytics_datasets(dataset_id,environment,activated_at) values($1,$2,'2018-01-01')",
      [ds, environment],
    );
    await db.query(
      "insert into public.analytics_consent_receipts(dataset_id,receipt_id,granted_at) values($1,$2,'2018-01-01')",
      [ds, receipt],
    );
    await db.query(
      "insert into public.analytics_order_context(dataset_id,order_id,line_snapshots,receipt_id,visitor_id,session_id,device) values($1,$2,'[]',$3,$4,$5,'desktop')",
      [ds, id, receipt, randomUUID(), session],
    );
    const fact = {
      datasetId: ds,
      factId: "order:" + id,
      orderId: id,
      revision: 1,
      kind: "order",
      effectiveAt: t,
      recordedAt: t,
      buyerKey: "sole-buyer:v1:" + "a".repeat(64),
      currency: "USD",
      payload: payloads.order,
    };
    for (const revision of [1, 3, 2])
      await db.query("select public.analytics_append_fact($1)", [{ ...fact, revision }]);
    const scope = (
      await db.query("select public.analytics_reconciliation_source($1,$2,$3) as value", [
        ds,
        t,
        "2026-01-01",
      ])
    ).rows[0].value;
    assert.deepEqual([scope.facts, scope.revisions, scope.pending], [1, 3, 3]);
    const snapshot = async (limit) =>
      (
        await db.query(
          "select public.analytics_reconciliation_snapshot($1,$2,$3,$4) as result",
          [ds, t, "2026-01-01", limit],
        )
      ).rows[0].result;
    await db.query("savepoint snapshot_bounds");
    await assert.rejects(snapshot(2001), { code: "22023" });
    await db.query("rollback to savepoint snapshot_bounds");
    await assert.rejects(
      db.query("select public.analytics_reconciliation_snapshot('missing',$1,$2,1)", [
        t,
        "2026-01-01",
      ]),
      { code: "22023" },
    );
    await db.query("rollback to savepoint snapshot_bounds");
    const evidence = await snapshot(3);
    assert.equal(evidence.revisions, 3);
    assert.deepEqual(
      evidence.publications.map((p) => p.fact.revision),
      [1, 2, 3],
    );
    assert.deepEqual(evidence.publications[2].fact, { ...fact, revision: 3 });
    assert.equal(new Set(evidence.publications.map((p) => p.publicationId)).size, 3);
    assert.equal((await snapshot(2)).publications.length, 2);
    await db.query("savepoint missing_publication");
    await db.query(
      "delete from public.analytics_publication_outbox where dataset_id=$1 and revision=2",
      [ds],
    );
    const unpublishable = await snapshot(3);
    assert.equal(unpublishable.revisions, 3);
    assert.equal(
      unpublishable.publications.find((p) => p.fact.revision === 2).publicationId,
      null,
    );
    await db.query("rollback to savepoint missing_publication");
    for (const role of [
      "anon",
      "authenticated",
      "sole_analytics_staging_reader",
      "service_role",
    ]) {
      const auth = await db.query(
        "select has_function_privilege($1,'public.analytics_reconciliation_snapshot(text,timestamptz,timestamptz,integer)','execute') as ok",
        [role],
      );
      assert.equal(auth.rows[0].ok, role === "service_role");
    }
    console.log(
      "PASS service-only bounded source reconciliation preserves all exact revision payloads and UUIDs",
    );
    for (const role of ["sole_analytics_staging_reader", "anon", "authenticated"]) {
      const accessible = async (s) =>
        (await db.query("select has_table_privilege($1,$2,'select') as ok", [role, s]))
          .rows[0].ok;
      for (const table of [
        "analytics_fact_versions",
        "analytics_order_context",
        "analytics_consent_receipts",
        "analytics_publication_outbox",
        "orders",
      ])
        assert.equal(
          await accessible("public." + table),
          table === "orders" && role !== "sole_analytics_staging_reader",
        );
      assert.equal(
        await accessible("analytics_reporting.analytics_financial_export"),
        role === "sole_analytics_staging_reader",
      );
    }
    await db.query("set local role sole_analytics_staging_reader");
    const rows = (
      await db.query("select * from analytics_reporting.analytics_financial_export")
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revision, 3);
    assert.equal(rows[0].buyer_key, fact.buyerKey);
    assert.deepEqual(rows[0].payload, fact.payload);
    assert.deepEqual(
      Object.keys(rows[0]).sort(),
      [
        "dataset_id",
        "environment",
        "fact_id",
        "revision",
        "kind",
        "effective_at",
        "recorded_at",
        "currency",
        "order_id",
        "buyer_key",
        "payload",
        "updated_at",
      ].sort(),
    );
    const link = async () =>
      (await db.query("select * from analytics_reporting.analytics_purchase_link_export"))
        .rows[0];
    const active = await link();
    assert.equal(active.session_id, session);
    assert.equal(active.active, true);
    assert.deepEqual(
      Object.keys(active).sort(),
      [
        "dataset_id",
        "order_id",
        "active",
        "visitor_id",
        "session_id",
        "device",
        "discovery",
        "purchase_session",
        "updated_at",
      ].sort(),
    );
    await db.query("reset role");
    for (const role of [
      "anon",
      "authenticated",
      "sole_analytics_staging_reader",
      "sole_analytics_production_reader",
      "service_role",
    ]) {
      const { can_verify, can_read } = (
        await db.query(
          `select has_function_privilege($1,'public.analytics_has_active_journey_link(text,uuid,uuid)','execute') as can_verify,
             has_table_privilege($1,'analytics_reporting.source_links','select') as can_read`,
          [role],
        )
      ).rows[0];
      assert.equal(can_verify, role === "service_role");
      assert.equal(can_read, false);
    }
    const hasJourneyLink = async (dataset, order, browserSession) =>
      (
        await db.query(
          "select public.analytics_has_active_journey_link($1,$2,$3) as matched",
          [dataset, order, browserSession],
        )
      ).rows[0].matched;
    await db.query("set local role service_role");
    assert.equal(await hasJourneyLink(ds, id, session), true);
    assert.equal(await hasJourneyLink(ds, id, randomUUID()), false);
    assert.equal(await hasJourneyLink(ds, randomUUID(), session), false);
    assert.equal(await hasJourneyLink("sole-production", id, session), false);
    await db.query("select public.analytics_revoke_receipt($1,$2)", [ds, receipt]);
    assert.equal(await hasJourneyLink(ds, id, session), false);
    await db.query("reset role");
    console.log(
      "PASS staging journey link requires an exact session and order with current consent",
    );
    const revoked = await link();
    assert.equal(revoked.active, false);
    assert.ok(revoked.updated_at >= active.updated_at);
    for (const p of [
      "session_id",
      "visitor_id",
      "device",
      "discovery",
      "purchase_session",
    ])
      assert.equal(revoked[p], null);
    const history = async () =>
      (await db.query("select public.analytics_read_history_evidence($1) as e", [ds]))
        .rows[0].e;
    assert.deepEqual(await history(), { archive: [], native: [], observation: null });
    await db.query(
      "insert into analytics_reporting.verified_behavior_intervals(dataset_id,source,start_at,end_at,verified_at) values($1,'archive','2018-01-01','2018-01-04','2018-01-05'),($1,'native','2018-01-06','2018-01-07','2018-01-08')",
      [ds],
    );
    assert.equal((await history()).archive.length, 1);
    assert.equal(
      (await history()).native.length,
      0,
      "Expired unqualified native coverage must be unavailable",
    );
    await db.query(
      "insert into analytics_reporting.warehouse_observations(dataset_id,source_fresh_through,observed_at) values($1,'2018-01-01','2018-01-02')",
      [ds],
    );
    assert.equal(
      Date.parse((await history()).observation.sourceFreshThrough),
      Date.parse("2018-01-01T00:00:00Z"),
    );
    console.log(
      "PASS absent hosted history evidence defaults unknown; explicit independently verified intervals/observations persist",
    );
    const event = randomUUID(),
      visitor = randomUUID();
    const statement =
      "insert into analytics_archive.analytics_behavior_archive(dataset_id,event_uuid,event_name,occurred_at,visitor_id,session_id,pathname) values($1,$2,'storefront_viewed',$3,$4,$5,'/store')";
    const searchId = randomUUID();
    await db.query(
      "insert into analytics_archive.analytics_behavior_archive(dataset_id,event_uuid,event_name,occurred_at,visitor_id,session_id,pathname,result_count,concept_kind,concept_id) values($1,$2,'catalog_search_results',$3,$4,$5,'/store',3,'brand',$6)",
      [ds, searchId, t, visitor, session, id],
    );
    assert.deepEqual(
      (
        await db.query(
          "select result_count,concept_kind,concept_id from analytics_reporting.analytics_behavior_export where event_uuid=$1",
          [searchId],
        )
      ).rows,
      [{ result_count: 3, concept_kind: "brand", concept_id: id }],
    );
    await db.query(
      "delete from analytics_archive.analytics_behavior_archive where event_uuid=$1",
      [searchId],
    );
    await db.query(statement, [ds, event, t, visitor, session]);
    await db.query(statement, [ds, event, t, visitor, session]);
    await db.query(statement, [ds, randomUUID(), "2017-12-31", visitor, session]);
    await db.query("set local role sole_analytics_staging_reader");
    assert.deepEqual(
      (
        await db.query(
          "select event_uuid,visitor_id,occurred_at from analytics_reporting.analytics_behavior_export",
        )
      ).rows,
      [{ event_uuid: event, visitor_id: visitor, occurred_at: new Date(t) }],
    );
    await db.query("reset role");
    await db.query("set local role sole_analytics_production_reader");
    for (const view of [
      "analytics_financial_export",
      "analytics_behavior_export",
      "analytics_purchase_link_export",
    ])
      assert.equal(
        (await db.query("select * from analytics_reporting." + view)).rowCount,
        0,
      );
    await db.query("reset role");
    console.log(
      "PASS archive overlap UUID deduplication, launch cutoff and cross-environment reader filtering",
    );
    console.log(
      "PASS curated latest revision survives raw expiry, exact buyer/payload, separate authorized link and revocation tombstone",
    );
    console.log(
      "PASS curated reader grants and exact columns exclude operational tables and private context/receipt",
    );
    await db.query(
      "insert into public.analytics_datasets(dataset_id,environment,activated_at) values('backlog-other','production','2018-01-01')",
    );
    await db.query(`with seeds as (select n, gen_random_uuid()::text id, case when n%5=0 then 'sole-staging' else 'backlog-other' end ds from generate_series(1,25000) n)
      insert into public.analytics_fact_versions(dataset_id,fact_id,revision,kind,effective_at,recorded_at,fact)
      select ds,id,1,'order',now(),now(),jsonb_build_object('factId',id) from seeds`);
    await db.query(`insert into public.analytics_publication_outbox(dataset_id,fact_id,revision,next_attempt_at)
      select dataset_id,fact_id,revision,now()-interval '1 second' from public.analytics_fact_versions where fact_id not like 'order:%'`);
    await db.query("analyze public.analytics_publication_outbox");
    const explain = (
      await db.query(`explain (analyze,buffers,format json) select q.id from public.analytics_publication_outbox q
     where q.dataset_id='sole-staging' and ((q.status='pending' and q.next_attempt_at<=statement_timestamp()) or
       (q.status='leased' and q.lease_expires_at<=statement_timestamp() and q.attempts<8))
     order by coalesce(q.lease_expires_at,q.next_attempt_at),q.id limit 50 for update skip locked`)
    ).rows[0]["QUERY PLAN"][0];
    const actual = await db.query(
      "explain (analyze,buffers,format json) select * from public.analytics_claim_publications('sole-staging',50,30)",
    );
    console.log(
      "PASS claim fixture",
      JSON.stringify({
        jobs: 25003,
        eligible: 5003,
        selectionMs: explain["Execution Time"],
        rpcMs: actual.rows[0]["QUERY PLAN"][0]["Execution Time"],
        plan: planShape(explain.Plan),
      }),
    );
  } finally {
    await db.query("rollback");
  }
}
function planShape(node) {
  return [
    node["Node Type"],
    node["Index Name"] ?? "",
    ...(node.Plans ?? []).map(planShape),
  ];
}
