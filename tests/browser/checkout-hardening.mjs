import { createCheckoutGate } from "../fixtures/checkout-gate.mjs";

const cart = "src/Modules/Cart/Tests/Features/";
const checkout = "src/Modules/Checkout/Tests/Features/";
const retained = cart + "ManageBasket/retained-cart.browser.mjs";
export async function runCheckoutBrowserChecks(gate, flags = []) {
  if (flags.length && flags.join(" ") !== "--break-cart")
    throw Error("Unexpected checkout browser arguments");
  // Launch the installed runtime before any case, even for a deliberate failure.
  await gate("chromium-runtime", [
    "--input-type=module",
    "-e",
    'import {chromium} from "@playwright/test"; const b=await chromium.launch(); await b.close()',
  ]);
  await gate(
    "original-basket-row-disappeared",
    ["--test", "--test-reporter=tap", retained],
    {
      env: { CHECKOUT_GATE_FAULT: "cart" },
      expectedFailure: "original basket row disappeared before confirmation",
      propagateFailure: flags.length > 0,
    },
  );
  for (const [name, file] of [
    ["retained-cart", retained],
    ["fixture", "tests/browser/checkout-hardening-fixture.test.mjs"],
    ["identity-and-validation", cart + "ManageBasket/basket-state.browser.mjs"],
    ["original-units", cart + "ManageBasket/purchase-capture.browser.mjs"],
    ["availability", cart + "ValidateBasket/availability.browser.mjs"],
    ["guest-context", checkout + "Preparation/guest-context.browser.test.mjs"],
    ["observations", checkout + "Outcomes/checkout-outcome.browser.mjs"],
  ])
    await gate(name, ["--test", file]);
  for (const name of [
    "payment-methods",
    "checkout-ui",
    "shipping-validation",
    "admin-transaction-detail",
    "admin-button-contrast",
    "shipping-settings-modal",
    "ux-checkout",
    "ux-receipt-authority",
    "ux-account-auth",
  ])
    await gate(name, ["tests/browser/" + name + ".mjs"]);
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
