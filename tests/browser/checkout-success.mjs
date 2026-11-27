import { execFileSync } from "node:child_process";
execFileSync(
  process.execPath,
  [
    "--test",
    "--test-name-pattern",
    "^receipt ",
    "src/Modules/Checkout/Tests/Features/Outcomes/checkout-outcome.browser.mjs",
  ],
  { stdio: "inherit" },
);
