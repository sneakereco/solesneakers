import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { withCheckoutDatabase } from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";

const mode = process.env.CHECKOUT_AUTHORITY_MODE ?? "fresh";
const tables = [
  "orders",
  "order_items",
  "order_shipping",
  "order_billing",
  "order_events",
  "order_access_tokens",
  "payment_transactions",
  "inventory_reservations",
  "square_refunds",
  "square_disputes",
  "square_webhook_events",
  "checkout_notification_outbox",
  "state_sales_tracking",
];
const callables = [
  "attach_square_checkout_order",
  "claim_checkout_notifications",
  "claim_checkout_notifications_for_order",
  "consume_square_checkout_reservation",
  "finish_checkout_notification",
  "process_square_dispute_event",
  "process_square_payment_event",
  "process_square_refund_event",
  "record_shippo_tracking_update",
  "record_square_payment_details",
  "release_square_checkout_reservation",
  "reserve_square_checkout_inventory",
  "reserve_square_checkout_inventory_with_address",
  "reserve_square_checkout_inventory_without_billing",
  "write_staff_order_fulfillment",
];

test("checkout authority on the replayed schema", async (t) => {
  await withCheckoutDatabase(mode, async ({ admin, connect, seedOrder }) => {
    const owned = await seedOrder({ status: "paid" });
    const other = await seedOrder();
    const customer = await connect("authenticated");
    const service = await connect("service_role");
    await customer.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owned.userId,
    ]);

    await t.test("client roles have no financial table mutation privileges", async () => {
      const result = await admin.query(
        `
        select rol, tbl, perm from unnest($1::text[]) tbl
        cross join unnest(array['anon','authenticated']) rol
        cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) perm
        where has_table_privilege(rol, 'public.' || tbl, perm)
        or case when perm in ('INSERT','UPDATE','REFERENCES') then
          has_any_column_privilege(rol, 'public.' || tbl, perm) else false end`,
        [tables],
      );
      assert.deepEqual(result.rows, []);
    });

    await t.test(
      "mutation procedures grant execution exclusively to the service among API roles",
      async () => {
        const { rows } = await admin.query(
          `
        select proname, has_function_privilege('anon',p.oid,'EXECUTE') as anon,
          has_function_privilege('authenticated',p.oid,'EXECUTE') as customer,
          has_function_privilege('service_role',p.oid,'EXECUTE') as service
        from pg_proc p where pronamespace = 'public'::regnamespace and proname = any($1)`,
          [callables],
        );
        assert.deepEqual(new Set(rows.map((row) => row.proname)), new Set(callables));
        assert.deepEqual(
          rows.filter((row) => row.anon || row.customer || !row.service),
          [],
        );
      },
    );

    await t.test(
      "profile truncation is absent and order reads are isolated",
      async () => {
        const { rows } = await customer.query(
          "select id from public.orders where id = any($1)",
          [[owned.orderId, other.orderId]],
        );
        assert.deepEqual(rows, [{ id: owned.orderId }]);
        const { rows: perms } = await admin.query(
          "select rol from unnest(array['anon','authenticated']) rol where has_table_privilege(rol,'public.profiles','TRUNCATE')",
        );
        assert.deepEqual(perms, []);
      },
    );

    await t.test(
      "a customer creates a normal profile, edits their name and saves an address",
      async () => {
        const id = randomUUID();
        const email = id + "@fixture.invalid";
        await admin.query(
          "insert into auth.users(id,email,role,aud) values ($1,$2,'authenticated','authenticated')",
          [id, email],
        );
        const {
          rows: [{ tenant_id }],
        } = await admin.query("select tenant_id from public.orders where id=$1", [
          owned.orderId,
        ]);
        const fresh = await connect("authenticated");
        await fresh.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
        await fresh.query(
          "insert into public.profiles(id,email,role,tenant_id) values ($1,$2,'customer',$3)",
          [id, email, tenant_id],
        );
        const profile = await fresh.query(
          "update public.profiles set full_name='Fixture Customer' where id=$1 returning full_name, role",
          [id],
        );
        assert.deepEqual(profile.rows, [
          { full_name: "Fixture Customer", role: "customer" },
        ]);
        const address = await fresh.query(
          "insert into public.user_addresses(user_id,city) values ($1,'Brooklyn') returning city",
          [id],
        );
        assert.deepEqual(address.rows, [{ city: "Brooklyn" }]);
      },
    );

    await t.test(
      "staff reads another customer order and the service persists labels and completed refunds",
      async () => {
        const staff = await connect("authenticated");
        await admin.query("update public.profiles set role='admin' where id=$1", [
          other.userId,
        ]);
        await staff.query("select set_config('request.jwt.claim.sub',$1,false)", [
          other.userId,
        ]);
        const order = await seedOrder({ status: "paid" });
        assert.equal(
          (await staff.query("select id from public.orders where id=$1", [order.orderId]))
            .rowCount,
          1,
        );
        const paymentId = randomUUID();
        await service.query(
          "update public.orders set payment_transaction_id=$2, fulfillment='ship', fulfillment_status='ready_to_ship',label_url='https://fixture.invalid/label',tracking_number=$3, label_created_by=$4 where id=$1",
          [order.orderId, paymentId, randomUUID(), other.userId],
        );
        assert.equal(
          (
            await service.query(
              "select id from public.checkout_notification_outbox where order_id=$1 and kind='label_created'",
              [order.orderId],
            )
          ).rowCount,
          1,
        );
        await service.query(
          "select public.process_square_refund_event($1,'refund.updated','fixture-store','fixture-location',now(),$2,'{}'::jsonb,$3,$4,'COMPLETED',1000,'USD')",
          [randomUUID(), "a".repeat(64), paymentId, randomUUID()],
        );
        const refund = await service.query(
          "select status,refund_amount::integer as cents from public.orders where id=$1",
          [order.orderId],
        );
        assert.deepEqual(refund.rows, [{ status: "refunded", cents: 1000 }]);
      },
    );

    await t.test(
      "resend can load profile, item snapshots, product, image, variant and shipping fields",
      async () => {
        const detail = await service.query(
          `select p.email, i.brand,i.model,i.size_label,i.variant_sku,
        product.name,product.category,img.url,img.is_primary,img.sort_order,v.sku,ship.city
        from public.orders o join public.profiles p on p.id=o.user_id
        left join public.order_items i on i.order_id=o.id left join public.products product on product.id=i.product_id
        left join public.product_images img on img.product_id=product.id
        left join public.product_variants v on v.id=i.variant_id left join public.order_shipping ship on ship.order_id=o.id
        where o.id=$1`,
          [owned.orderId],
        );
        assert.equal(
          detail.rows[0].email,
          "checkout-" + owned.userId + "@fixture.invalid",
        );
      },
    );

    // Staff screens offer shipping from ready_to_ship and pickup from unfulfilled.
    // Recheck the persisted state when the submitted action reaches the database.
    const staff = await seedOrder();
    await admin.query("update public.profiles set role='admin' where id=$1", [
      staff.userId,
    ]);
    for (const [label, action, method, financial, fulfillment] of [
      ["delivered shipment", "fulfill", "ship", "paid", "delivered"],
      ["pickup sent to shipping", "fulfill", "pickup", "paid", "ready_to_ship"],
      ["shipment sent to pickup", "pickup", "ship", "paid", "unfulfilled"],
      ["shipment awaiting label", "fulfill", "ship", "paid", "unfulfilled"],
      ["unsettled shipment", "fulfill", "ship", "pending", "ready_to_ship"],
      ["fully refunded pickup", "pickup", "pickup", "refunded", "unfulfilled"],
      ["delivered pickup", "pickup", "pickup", "paid", "delivered"],
      ["changed tracking after dispatch", "fulfill", "ship", "shipped", "shipped"],
    ]) {
      await t.test("rejects stale or ineligible staff action: " + label, async () => {
        const { orderId } = await seedOrder({ status: financial });
        await admin.query(
          "update public.orders set fulfillment=$2,fulfillment_status=$3 where id=$1",
          [orderId, method, fulfillment],
        );
        const read = () =>
          admin.query(
            "select to_jsonb(o) as projection,(select count(*) from public.order_events where order_id=o.id) as events from public.orders o where o.id=$1",
            [orderId],
          );
        const before = await read();
        await assert.rejects(
          service.query(
            "select id from public.write_staff_order_fulfillment($1,$2,$3,$4,$5)",
            [orderId, action, staff.userId, "USPS", "tracking-1"],
          ),
          { code: "22023" },
        );
        assert.deepEqual((await read()).rows, before.rows);
      });
    }

    await t.test(
      "trusted pickup and shipping commit the projection and a single attributed event on retry",
      async () => {
        await admin.query("update public.profiles set role='admin' where id=$1", [
          other.userId,
        ]);
        for (const [action, status] of [
          ["pickup", "picked_up"],
          ["fulfill", "shipped"],
        ]) {
          const order = await seedOrder({
            status: action === "pickup" ? "partially_refunded" : "paid",
          });
          if (action === "fulfill")
            await admin.query(
              "update public.orders set fulfillment='ship', fulfillment_status='ready_to_ship' where id=$1",
              [order.orderId],
            );
          let firstVersion;
          for (let i = 0; i < 2; i++) {
            const { rows } = await service.query(
              "select id, fulfillment_status from public.write_staff_order_fulfillment($1,$2,$3,$4,$5)",
              [order.orderId, action, other.userId, null, null],
            );
            assert.deepEqual(rows, [{ id: order.orderId, fulfillment_status: status }]);
            const version = (
              await admin.query(
                "select xmin::text as version from public.orders where id=$1",
                [order.orderId],
              )
            ).rows[0].version;
            if (i === 0) firstVersion = version;
            else
              assert.equal(
                version,
                firstVersion,
                "identical retry must not rewrite the row",
              );
          }
          const { rows } = await admin.query(
            "select type,created_by from public.order_events where order_id=$1",
            [order.orderId],
          );
          assert.deepEqual(rows, [{ type: status, created_by: other.userId }]);
        }
      },
    );
  });
});
