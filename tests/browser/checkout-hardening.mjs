import { createCheckoutGate } from "../fixtures/checkout-gate.mjs";
import { selectCheckoutShard } from "../fixtures/checkout-shards.mjs";

const cart = "src/Modules/Cart/Tests/Features/";
const checkout = "src/Modules/Checkout/Tests/Features/";
const retained = cart + "ManageBasket/retained-cart.browser.mjs";
export async function runCheckoutBrowserChecks(gate, flags = []) {
  const checks = selectCheckoutShard(
    [
      [
        1,
        "original-basket-row-disappeared",
        ["--test", "--test-reporter=tap", retained],
        {
          env: { CHECKOUT_GATE_FAULT: "cart" },
          expectedFailure: "original basket row disappeared before confirmation",
          propagateFailure: flags.includes("--break-cart"),
        },
      ],
      ...[
        [1, "retained-cart", retained],
        [1, "fixture", "tests/browser/checkout-hardening-fixture.test.mjs"],
        [1, "identity-and-validation", cart + "ManageBasket/basket-state.browser.mjs"],
        [4, "original-units", cart + "ManageBasket/purchase-capture.browser.mjs"],
        [4, "availability", cart + "ValidateBasket/availability.browser.mjs"],
        [2, "guest-context", checkout + "Preparation/guest-context.browser.test.mjs"],
        [2, "observations", checkout + "Outcomes/checkout-outcome.browser.mjs"],
      ].map(([shard, name, file]) => [shard, name, ["--test", file]]),
      ...[
        [2, "payment-methods"],
        [2, "checkout-ui"],
        [4, "shipping-validation"],
        [3, "admin-transaction-detail"],
        [2, "admin-button-contrast"],
        [3, "shipping-settings-modal"],
        [3, "ux-checkout"],
        [3, "ux-receipt-authority"],
        [4, "ux-account-auth"],
      ].map(([shard, name]) => [shard, name, ["tests/browser/" + name + ".mjs"]]),
    ],
    flags,
    "--break-cart",
  );
  // Launch the installed runtime before any case, even for a deliberate failure.
  await gate("chromium-runtime", [
    "--input-type=module",
    "-e",
    'import {chromium} from "@playwright/test"; const b=await chromium.launch(); await b.close()',
  ]);
  for (const check of checks) await gate(...check);
}

if (import.meta.main) {
  try {
    await runCheckoutBrowserChecks(
      await createCheckoutGate("browser"),
      process.argv.slice(2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
