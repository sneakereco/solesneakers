import assert from "node:assert/strict";
import test from "node:test";
import { withCheckoutDatabase } from "./fixtures/checkout-hardening.mjs";

test("stock never becomes negative after one unit sells", async () => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, seedCatalog }) => {
      const { variantId } = await seedCatalog({ stock: 1 });
      const requested = process.env.CHECKOUT_GATE_FAULT === "stock" ? 2 : 1;
      const update = await admin
        .query("update product_variants set stock=stock-$2 where id=$1 returning stock", [
          variantId,
          requested,
        ])
        .catch((error) => {
          if (
            error.code === "23514" &&
            error.constraint === "product_variants_stock_check"
          )
            throw Error("stock became negative in checkout fixture");
          throw error;
        });
      assert.equal(update.rows[0].stock, 0, "stock became negative in checkout fixture");
    },
  );
});
