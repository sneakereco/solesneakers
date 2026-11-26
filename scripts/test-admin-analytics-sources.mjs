import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Called only after the parent runner verifies database, owner, loopback and its exclusive lock.
export async function testCommerceSources(db, worker) {
  const ds = "sole-staging",
    owner = randomUUID(),
    brand = randomUUID(),
    product = randomUUID();
  const variants = [randomUUID(), randomUUID()],
    receipt = randomUUID(),
    attempt = randomUUID();
  const buyerKey = "sole-buyer:v1:" + "b".repeat(64);
  const query = (sql, params = []) => db.query(sql, params);
  const one = async (s, p) => (await query(s, p)).rows[0];
  const flush = async () => {
    await query("set constraints all immediate");
    await query("set constraints all deferred");
  };
  const facts = async (kind, id) =>
    (
      await query(
        "select distinct on(fact_id) fact from public.analytics_fact_versions where dataset_id=$1 and kind=$2 and ($3::uuid is null or fact->>'orderId'=$3::text) order by fact_id, revision desc",
        [ds, kind, id],
      )
    ).rows.map((r) => r.fact);
  await query("begin");
  try {
    assert.equal((await one("select count(*)::int n from public.tenants")).n, 0);
    await query("insert into public.tenants(id,name) values($1,'Analytics fixture')", [
      owner,
    ]);
    await query(
      "insert into public.analytics_datasets(dataset_id,environment,activated_at) values($1,'staging',now()-interval '1 day')",
      [ds],
    );
    await query(
      "insert into public.analytics_consent_receipts(dataset_id,receipt_id) values($1,$2)",
      [ds, receipt],
    );
    await query(
      "insert into public.tag_brands(id,canonical_label) values($1,'Fixture')",
      [brand],
    );
    await query(
      "insert into public.products(id,tenant_id,name,category,condition,brand_id,size_type) values($1,$2,'Fixture','sneakers','new',$3,'shoe')",
      [product, owner, brand],
    );
    for (const [i, variant] of variants.entries()) {
      const size = randomUUID();
      await query(
        "insert into public.tag_sizes(id,canonical_label,size_type) values($1,$2,'shoe')",
        [size, String(i + 10)],
      );
      await query(
        "insert into public.product_variants(id,tenant_id,product_id,size_id,sku,stock,sale_price_cents,unit_cost_recorded) values($1,$2,$3,$4,$5,5,1000,$6)",
        [variant, owner, product, size, "SKU-" + variant, i === 1],
      );
    }
    const checkout = {
      p_guest_email: "fixture@example.com",
      p_currency: "USD",
      p_fulfillment: "pickup",
      p_payment_method: "applePay",
      p_idempotency_key: randomUUID(),
      p_cart_hash: "a".repeat(64),
      p_expires_at: new Date(Date.now() + 600000).toISOString(),
      p_subtotal_cents: 2000,
      p_shipping_cents: 0,
      p_tax_cents: 0,
      p_total_cents: 2000,
      p_tax_calculation_id: "square:pending",
      p_customer_state: "SC",
      p_pickup_contact: { name: "Fixture", phone: "5555550123" },
      p_billing_address: {
        given_name: "Fixture",
        family_name: "Buyer",
        line1: "Example",
        city: "Example",
        state: "SC",
        postal_code: "29111",
        country: "US",
      },
      p_items: variants.map((v, i) => ({
        product_id: product,
        variant_id: v,
        quantity: 1,
        unit_price_cents: 1000,
        unit_cost_cents: 0,
        line_total_cents: 1000,
        product_name: i ? "Safe shoe" : "x@example.com",
        size_label: String(i + 10),
        variant_sku: "SKU-" + v,
        category: "sneakers",
        brand: "Fixture",
        condition: "new",
      })),
      p_protection_evidence: { payment_method: "applePay" },
    };
    const context = {
      datasetId: ds,
      buyerKey,
      tracking: null,
      totals: { subtotalCents: 2000, shippingCents: 0, taxCents: 100, totalCents: 2100 },
    };
    const reserve = async (input, ctx) =>
      (
        await one(
          "select public.reserve_square_checkout_inventory_with_analytics($1,$2) as r",
          [input, ctx],
        )
      ).r;
    await query("set local role service_role");
    const first = await reserve(checkout, context);
    assert.equal(first.reused, false);
    assert.equal(
      (
        await reserve(checkout, {
          ...context,
          buyerKey: null,
          tracking: {
            receiptId: receipt,
            visitorId: randomUUID(),
            sessionId: randomUUID(),
            device: "desktop",
          },
        })
      ).order_id,
      first.order_id,
    );
    await query("reset role");
    const oid = first.order_id;
    await flush();
    const snap = await one(
      "select * from public.analytics_order_context where order_id=$1",
      [oid],
    );
    assert.equal(snap.receipt_id, null);
    assert.equal(snap.buyer_key, buyerKey);
    assert.deepEqual(snap.line_snapshots.map((l) => l.unitCostCents).sort(), [0, null]);
    assert.equal(
      snap.line_snapshots.find((l) => l.variantId === variants[0]).productName,
      null,
    );
    assert.equal((await facts("order", oid)).length, 0);
    assert.equal(
      (
        await one(
          "select min(stock) n from public.product_variants where id=any($1::uuid[])",
          [variants],
        )
      ).n,
      4,
    );
    console.log(
      "PASS real locked reservation with optional retry, one stock decrement, unknown versus explicit-zero COGS and safe labels",
    );

    const old = (
      await one(
        "insert into public.orders(tenant_id,guest_email,status,subtotal,shipping,total,created_at) values($1,'older@example.com','pending',0,0,0,now()-interval '2 days') returning id",
        [owner],
      )
    ).id;
    await query("update public.orders set status='paid' where id=$1", [old]);
    const zero = (
      await one(
        "insert into public.orders(tenant_id,status,subtotal,shipping,total,fulfillment,guest_email) values($1,'paid',0,0,0,'pickup','zero@example.com') returning id",
        [owner],
      )
    ).id;
    await flush();
    assert.equal((await facts("order", old)).length, 0);
    assert.equal((await facts("order", zero))[0].payload.totalCollectedCents, 0);
    assert.equal((await facts("order", zero))[0].payload.paymentMethod, null);
    assert.equal((await facts("payment_attempt", zero)).length, 0);
    console.log(
      "PASS preactivation edits excluded, confirmed zero-balance order has no paid attempt",
    );

    const sid = "sq-" + oid,
      pid = "pay-" + oid;
    await query(
      "update public.orders set square_order_id=$2,square_order_version=1 where id=$1",
      [oid, sid],
    );
    const start = new Date(Date.now() - 1000).toISOString(),
      resolved = new Date().toISOString();
    const op = {
      attemptId: attempt,
      effectiveAt: start,
      orderId: oid,
      method: "applePay",
      outcome: "unknown",
      stage: "payment",
      reason: "timeout",
      resolvedAt: null,
    };
    await query("select public.analytics_record_operational_outcome($1,$2)", [ds, op]);
    const event = {
      squareOrderId: sid,
      paymentId: pid,
      amountCents: 2100,
      currency: "USD",
      paymentStatus: "COMPLETED",
      resolvedAt: resolved,
      orderReference: oid,
      attemptId: attempt,
      fees: [
        { type: "INITIAL", adjustment: "charge", amountCents: 31, effectiveAt: resolved },
      ],
    };
    const pay = async (id, data) =>
      one(
        "select public.process_square_payment_event($1,'payment.updated','fixture','fixture',$2,$3,$4,$5,$6,'COMPLETED',2100,'USD',null) as r",
        [id, start, "a".repeat(64), data, sid, pid],
      );
    await pay("evt-" + oid, event);
    await flush();
    assert.equal((await pay("evt-" + oid, event)).r.duplicate, true);
    await pay("reconcile-" + oid, {
      ...event,
      fees: [
        ...event.fees,
        {
          type: "ADJUSTMENT",
          adjustment: "credit",
          amountCents: 7,
          effectiveAt: new Date(Date.now() + 1000).toISOString(),
        },
      ],
    });
    await flush();
    const sale = (await facts("order", oid))[0];
    assert.equal(sale.payload.totalCollectedCents, 2100);
    assert.equal(sale.payload.taxCents, 100);
    assert.equal(sale.payload.paymentMethod, "applePay");
    assert.equal(Date.parse(sale.effectiveAt), Date.parse(resolved));
    const attempts = await facts("payment_attempt", oid);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].payload.outcome, "succeeded");
    assert.equal(Date.parse(attempts[0].effectiveAt), Date.parse(start));
    assert.deepEqual(
      (await facts("fee", oid)).map((f) => f.payload.amountCents).sort((a, b) => a - b),
      [7, 31],
    );
    await query(
      "update public.product_variants set unit_cost_cents=9999,sale_price_cents=8888 where product_id=$1",
      [product],
    );
    await query(
      "update public.orders set status='shipped',guest_email='different@example.com',subtotal=200,total=210,shipping=4,tax_amount=6,actual_shipping_cost_cents=399,label_created_at=now(),shipped_at=now(),fulfillment_status='shipped' where id=$1",
      [oid],
    );
    await flush();
    const shipped = (await facts("order", oid))[0];
    assert.deepEqual(shipped.payload, { ...sale.payload, status: "shipped" });
    assert.equal(shipped.buyerKey, buyerKey);
    assert.equal(shipped.effectiveAt, sale.effectiveAt);
    assert.deepEqual(
      (await facts("line", oid)).map((f) => f.payload.unitCostCents).sort(),
      [0, null],
    );
    assert.equal((await facts("shipping_cost", oid))[0].payload.amountCents, 399);
    assert.equal((await facts("fulfillment", oid))[0].payload.state, "shipped");
    console.log(
      "PASS completed webhook and reconciliation share sale and timeout attempt; immutable sale basis, late actual charge and credit",
    );

    const refundId = "refund-" + oid;
    const refund = async (status, at) => {
      await one(
        "select public.process_square_refund_event($1,'refund.updated','fixture','fixture',$2,$3,$4,$5,$6,$7,100,'USD')",
        [randomUUID(), at, "b".repeat(64), {}, pid, refundId, status],
      );
      await flush();
    };
    await refund("PENDING", start);
    assert.equal((await facts("refund", oid)).length, 0);
    await refund("FAILED", start);
    assert.equal((await facts("refund", oid)).length, 0);
    await refund("COMPLETED", resolved);
    const r = (await facts("refund", oid))[0];
    assert.equal(Date.parse(r.effectiveAt), Date.parse(resolved));
    assert.deepEqual(r.payload, {
      refundId: r.payload.refundId,
      status: "completed",
      totalCents: 100,
      unallocatedCents: 100,
      shippingCents: null,
      taxCents: null,
      merchandiseCents: null,
    });
    assert.equal((await facts("refund_line", oid)).length, 0);
    for (const outcome of ["failed", "expired", "canceled"]) {
      await query("select public.analytics_record_operational_outcome($1,$2)", [
        ds,
        {
          ...op,
          attemptId: randomUUID(),
          outcome,
          reason: outcome === "failed" ? "declined" : outcome,
          effectiveAt: start,
          resolvedAt: resolved,
          orderId: null,
        },
      ]);
    }
    assert.equal(
      (await facts("payment_attempt", null)).filter((a) => a.orderId === null).length,
      3,
    );
    const tracking = {
      receiptId: receipt,
      visitorId: randomUUID(),
      sessionId: randomUUID(),
      device: "desktop",
      discovery: null,
      purchaseSession: null,
    };
    const second = await reserve(
      { ...checkout, p_idempotency_key: randomUUID() },
      { ...context, tracking },
    );
    assert.equal(
      (
        await one(
          "select receipt_id from public.analytics_order_context where order_id=$1",
          [second.order_id],
        )
      ).receipt_id,
      receipt,
    );
    await query("select public.analytics_revoke_receipt($1,$2)", [ds, receipt]);
    const third = await reserve(
      { ...checkout, p_idempotency_key: randomUUID() },
      { ...context, tracking },
    );
    assert.equal(
      (
        await one(
          "select receipt_id from public.analytics_order_context where order_id=$1",
          [third.order_id],
        )
      ).receipt_id,
      null,
    );
    const plain = await reserve({ ...checkout, p_idempotency_key: randomUUID() }, null);
    assert.equal(
      (
        await one(
          "select buyer_key from public.analytics_order_context where order_id=$1",
          [plain.order_id],
        )
      ).buyer_key,
      null,
    );
    await query(
      "select public.release_square_checkout_reservation($1,'checkout_expired')",
      [third.order_id],
    );
    await flush();
    assert.equal(
      (await facts("payment_attempt", third.order_id))[0].payload.outcome,
      "expired",
    );
    await query(
      "delete from public.inventory_reservations where variant_id=any($1::uuid[])",
      [variants],
    );
    await query("delete from public.product_variants where product_id=$1", [product]);
    await query("delete from public.products where id=$1", [product]);
    await flush();
    assert.equal((await facts("line", oid)).length, 2);
    assert.equal((await facts("line", oid))[0].payload.productId, product);
    assert.equal(
      (await facts("inventory", null)).find((f) => f.payload.variantId === variants[0])
        .payload.availableUnits,
      0,
    );
    console.log(
      "PASS active versus revoked receipt, absent optional context, real reservation expiry and deleted catalog snapshots",
    );
    const serialized = JSON.stringify(
      (
        await query(
          "select fact from public.analytics_fact_versions where dataset_id=$1",
          [ds],
        )
      ).rows,
    );
    for (const secret of ["@example.com", "5555550123", receipt, pid, sid])
      assert(!serialized.includes(secret));
    assert.equal(
      (
        await worker.query(
          "select count(*)::int n from public.analytics_fact_versions where dataset_id=$1",
          [ds],
        )
      ).rows[0].n,
      0,
    );
    console.log(
      "PASS completed-only refund and missing allocations, no-order failures, no raw identifiers, independent worker sees no uncommitted facts",
    );
  } finally {
    await query("rollback");
  }

  // The same timeout and provider resolution can race in different sessions.
  // Use committed fixture setup and a real held transaction-level fact lock.
  await query(
    "insert into public.analytics_datasets(dataset_id,environment,activated_at) values($1,'staging',now()-interval '1 day')",
    [ds],
  );
  try {
    const anchor = new Date().toISOString(),
      id = randomUUID();
    const pending = {
      attemptId: id,
      orderId: null,
      stage: "payment",
      method: "card",
      outcome: "unknown",
      reason: "timeout",
      effectiveAt: anchor,
      resolvedAt: null,
    };
    const succeeded = {
      ...pending,
      outcome: "succeeded",
      reason: "none",
      resolvedAt: anchor,
    };
    const sql = "select public.analytics_record_operational_outcome($1,$2)";
    await query("begin");
    await query(sql, [ds, pending]);
    const workerPid = (await worker.query("select pg_backend_pid() as pid")).rows[0].pid;
    const waiting = worker.query(sql, [ds, succeeded]);
    try {
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (
          await one("select pg_backend_pid()=any(pg_blocking_pids($1)) as blocked", [
            workerPid,
          ])
        ).blocked;
      }
      assert(blocked, "independent provider resolution waited for the timeout writer");
    } finally {
      await query("commit");
      await waiting;
    }
    await query(sql, [ds, pending]);
    const latest = await facts("payment_attempt", null);
    assert.equal(latest.length, 1);
    assert.equal(latest[0].revision, 2);
    assert.equal(latest[0].payload.outcome, "succeeded");
    console.log(
      "PASS concurrent independent timeout and provider writers serialize one attempt, stale unknown cannot undo resolution",
    );
  } finally {
    await query("rollback");
    for (const table of [
      "analytics_publication_outbox",
      "analytics_fact_versions",
      "analytics_datasets",
    ])
      await query("delete from public." + table + " where dataset_id=$1", [ds]);
  }
}
