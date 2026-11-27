import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runnerUrl = new URL("../browser/checkout-hardening.mjs", import.meta.url);
async function runner() {
  assert.match(
    await readFile(runnerUrl, "utf8"),
    /export async function runCheckoutBrowserChecks/,
    "The aggregate runner must expose its gate execution boundary",
  );
  return (await import(runnerUrl.href)).runCheckoutBrowserChecks;
}
async function collect(flags = []) {
  const calls = [];
  await (
    await runner()
  )((...args) => {
    calls.push(args);
    return Promise.resolve();
  }, flags);
  return calls;
}

test("runs every unique browser suite once and keeps both runtime/fault controls", async () => {
  const calls = await collect();
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "chromium-runtime",
      "original-basket-row-disappeared",
      "retained-cart",
      "fixture",
      "identity-and-validation",
      "original-units",
      "availability",
      "guest-context",
      "observations",
      "payment-methods",
      "checkout-ui",
      "shipping-validation",
      "admin-transaction-detail",
      "admin-button-contrast",
      "shipping-settings-modal",
      "ux-checkout",
      "ux-receipt-authority",
      "ux-account-auth",
    ],
  );
  const commands = calls.map(([, args]) => args);
  const outcome =
    "src/Modules/Checkout/Tests/Features/Outcomes/checkout-outcome.browser.mjs";
  assert.deepEqual(
    commands.filter((args) => args.includes(outcome)),
    [["--test", outcome]],
  );
  assert.ok(
    commands.every(
      (args) => !args.some((arg) => /checkout-(success|progress)\.mjs$/.test(arg)),
    ),
  );
  for (const args of commands.filter(([first]) => first !== "--input-type=module")) {
    const file = args.at(-1);
    assert.ok(
      (await readFile(new URL("../../" + file, import.meta.url), "utf8")).length,
      file,
    );
  }
  for (const [wrapper, pattern] of [
    ["checkout-success", "^receipt "],
    ["checkout-progress", "^actual "],
  ]) {
    const source = await readFile(
      new URL(`../browser/${wrapper}.mjs`, import.meta.url),
      "utf8",
    );
    assert.ok(source.includes(outcome) && source.includes(pattern), wrapper);
  }
});

test("keeps the original basket fault injection and explicit broken-gate behavior", async () => {
  const normal = (await collect())[1];
  const broken = (await collect(["--break-cart"]))[1];
  assert.equal(
    normal[2].expectedFailure,
    "original basket row disappeared before confirmation",
  );
  assert.equal(normal[2].env.CHECKOUT_GATE_FAULT, "cart");
  assert.equal(normal[2].propagateFailure, false);
  assert.equal(broken[2].propagateFailure, true);
});

test("ordinary suite failures stop the runner and remain failures", async () => {
  const visited = [];
  const failure = Error("fixture suite failed");
  await assert.rejects(
    (await runner())((name) => {
      visited.push(name);
      return name === "observations" ? Promise.reject(failure) : Promise.resolve();
    }),
    (error) => error === failure,
  );
  assert.equal(visited.at(-1), "observations");
});

test("invalid arguments cannot bypass the browser checks", async () => {
  let calls = 0;
  await assert.rejects(
    (await runner())(() => {
      calls++;
      return Promise.resolve();
    }, ["--skip"]),
    /Unexpected checkout browser arguments/,
  );
  assert.equal(calls, 0);
});
