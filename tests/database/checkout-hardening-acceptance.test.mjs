import assert from "node:assert/strict";
import test from "node:test";
import { withCheckoutDatabase } from "./fixtures/checkout-hardening.mjs";
import { rejectedStockDiagnostic } from "../fixtures/checkout-gate.mjs";

async function sellStock(admin, variantId, requested) {
  let update;
  try {
    update = await admin.query(
      "update product_variants set stock=stock-$2 where id=$1 returning stock",
      [variantId, requested],
    );
  } catch (error) {
    if (
      requested !== 2 ||
      error.code !== "23514" ||
      error.constraint !== "product_variants_stock_check"
    )
      throw error;
    const stored = await admin.query("select stock from product_variants where id=$1", [
      variantId,
    ]);
    assert.deepEqual(
      stored.rows,
      [{ stock: 1 }],
      "rejected oversell must preserve the original unit",
    );
    throw Error(rejectedStockDiagnostic);
  }
  assert.equal(update.rowCount, 1, "fixture variant must exist");
  if (requested === 2)
    throw Error(
      "oversell unexpectedly succeeded with persisted stock " + update.rows[0].stock,
    );
  assert.equal(update.rows[0].stock, 0, "selling one unit must leave zero stock");
}

test("stock never becomes negative after one unit sells", async () => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, seedCatalog }) => {
      const { variantId } = await seedCatalog({ stock: 1 });
      const requested = process.env.CHECKOUT_GATE_FAULT === "stock" ? 2 : 1;
      await sellStock(admin, variantId, requested);
    },
  );
});

test("a successful negative write fails the control with a distinct diagnostic", async () => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, seedCatalog }) => {
      const { variantId } = await seedCatalog({ stock: 1 });
      await admin.query("begin");
      try {
        // Rehearse an absent check in a session-private table. The real catalog
        // and its constraints remain intact, including after a failed assertion.
        await admin.query(
          "create temp table product_variants(id uuid primary key, stock integer not null) on commit drop",
        );
        await admin.query("insert into pg_temp.product_variants values ($1,1)", [
          variantId,
        ]);
        await assert.rejects(sellStock(admin, variantId, 2), {
          message: "oversell unexpectedly succeeded with persisted stock -1",
        });
        assert.equal(
          (
            await admin.query("select stock from pg_temp.product_variants where id=$1", [
              variantId,
            ])
          ).rows[0].stock,
          -1,
        );
      } finally {
        await admin.query("rollback");
      }
      assert.equal(
        (
          await admin.query("select stock from public.product_variants where id=$1", [
            variantId,
          ])
        ).rows[0].stock,
        1,
      );
    },
  );
});

test("mail workers can claim and finish only with the owned lease protocol", async () => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin }) => {
      const permitted = await admin.query(
        "select proname, has_function_privilege('service_role',p.oid,'EXECUTE') as allowed from pg_proc p where pronamespace='public'::regnamespace and proname=any($1) order by proname",
        [
          [
            "claim_checkout_mail",
            "claim_checkout_notifications",
            "claim_checkout_notifications_for_order",
            "claim_checkout_notifications_v2",
            "finish_checkout_mail_disposition",
            "finish_checkout_notification",
          ],
        ],
      );
      assert.equal(permitted.rowCount, 6);
      assert.deepEqual(
        permitted.rows.filter((r) => r.allowed).map((r) => r.proname),
        ["claim_checkout_mail", "finish_checkout_mail_disposition"],
      );
    },
  );
});
