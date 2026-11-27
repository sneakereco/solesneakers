import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// The parent verifies the owned database and holds the fixture lock on db.
export async function checkStockLaunch(db, writer) {
  const dataset = "sole-staging";
  const [tenant, brand, size, product, variant] = Array.from({ length: 5 }, () =>
    randomUUID(),
  );
  const read = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  assert.deepEqual(
    await read(`select not exists(select from public.analytics_datasets where dataset_id in ('sole-staging','sole-production')) as inactive,
      not exists(select from public.product_variants) as empty_catalog`),
    { inactive: true, empty_catalog: true },
    "Stock launch needs the isolated inactive fixture and an empty variant catalog",
  );
  await db.query("begin");
  try {
    await db.query(
      "insert into public.tenants(id,name) values($1,'Stock launch fixture')",
      [tenant],
    );
    await db.query(
      "insert into public.tag_brands(id,canonical_label) values($1,'Stock launch fixture')",
      [brand],
    );
    await db.query(
      "insert into public.tag_sizes(id,canonical_label,size_type) values($1,'12','shoe')",
      [size],
    );
    await db.query(
      "insert into public.products(id,tenant_id,name,category,condition,brand_id,size_type) values($1,$2,'Fixture','sneakers','new',$3,'shoe')",
      [product, tenant, brand],
    );
    await db.query(
      "insert into public.product_variants(id,tenant_id,product_id,size_id,sku,stock,sale_price_cents) values($1,$2,$3,$4,$5,5,1000)",
      [variant, tenant, product, size, "SKU-" + variant],
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }

  let pending;
  try {
    await writer.query("begin isolation level read committed");
    const [{ pid, started }] = (
      await writer.query(
        "select pg_backend_pid() as pid,transaction_timestamp()::text as started",
      )
    ).rows;
    await db.query("begin");
    const { activation } = await read(
      "select public.activate_analytics_dataset('staging',statement_timestamp(),'archive') as activation",
    );
    assert.deepEqual(activation, {
      datasetId: dataset,
      created: true,
      baselineVariants: 1,
    });
    assert.equal(
      (
        await read(
          "select activated_at>$1::timestamptz as after_writer_start from public.analytics_datasets where dataset_id=$2",
          [started, dataset],
        )
      ).after_writer_start,
      true,
    );
    pending = writer
      .query("update public.product_variants set stock=3 where id=$1", [variant])
      .then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
    const deadline = performance.now() + 2500;
    let blocked = false;
    while (performance.now() < deadline) {
      const result = await read(
        "select pg_backend_pid()=any(pg_blocking_pids($1)) as blocked",
        [pid],
      );
      if (result.blocked) {
        blocked = true;
        break;
      }
    }
    assert.ok(blocked, "Prelaunch writer reached activation's stock lock");
    const { releasedAfter } = await read(
      'select clock_timestamp()::text as "releasedAfter"',
    );
    await db.query("commit");
    const { error, result } = await pending;
    if (error) throw error;
    assert.equal(result.rowCount, 1);
    await writer.query("commit");
    assert.equal(
      (await read("select stock from public.product_variants where id=$1", [variant]))
        .stock,
      3,
    );
    const { rows } = await db.query(
      `select v.revision,(v.fact->'payload'->>'availableUnits')::int as stock,q.id is not null as published,
         v.recorded_at >= $2 as observed_after_release, v.effective_at::text as anchor
       from public.analytics_fact_versions v left join public.analytics_publication_outbox q using(dataset_id,fact_id,revision)
       where dataset_id=$3 and v.fact_id='inventory:'||$1 order by v.revision`,
      [variant, releasedAfter, dataset],
    );
    assert.deepEqual(
      rows.map(({ revision, stock, published, observed_after_release }) => [
        revision,
        stock,
        published,
        observed_after_release,
      ]),
      [
        [1, 5, true, false],
        [2, 3, true, true],
      ],
      "The deferred stock write must journal after launch beside the original baseline",
    );
    assert.equal(
      rows[1].anchor,
      rows[0].anchor,
      "Stock revisions preserve the original effective time",
    );
    console.log(
      "PASS prelaunch stock writer waited for activation and committed the journaled post-launch revision",
    );
  } finally {
    await db.query("rollback");
    await pending;
    await writer.query("rollback");
    await db.query("begin");
    try {
      for (const table of ["analytics_publication_outbox", "analytics_fact_versions"]) {
        await db.query(
          "delete from public." +
            table +
            " where dataset_id=$1 and fact_id='inventory:'||$2",
          [dataset, variant],
        );
      }
      await db.query("delete from public.analytics_datasets where dataset_id=$1", [
        dataset,
      ]);
      for (const [table, id] of [
        ["product_variants", variant],
        ["products", product],
        ["tag_sizes", size],
        ["tag_brands", brand],
        ["tenants", tenant],
      ]) {
        await db.query("delete from public." + table + " where id=$1", [id]);
      }
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }
}
