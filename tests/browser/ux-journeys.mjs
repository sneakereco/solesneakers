import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { scripts } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const existing = [scripts["test:e2e"], scripts["test:measurement:browser"]].flatMap(
  (script) =>
    script.split(" && ").map((command) => {
      const match = /^node (tests\/browser\/[\w-]+\.mjs)$/.exec(command);
      if (!match) throw Error("Update the browser orchestrator for " + command);
      return match[1];
    }),
);
const ux = [
  "primitives",
  "overlays",
  "storefront",
  "account-auth",
  "admin",
  "receipt-authority",
  "checkout",
].map((name) => "tests/browser/ux-" + name + ".mjs");
const suites = [...existing, ...ux];
if (process.argv.includes("--local")) suites.push("tests/browser/ux-local-journeys.mjs");
let failed = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [suite], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    failed++;
    console.error("FAILED", suite, result.error?.message ?? result.status);
  }
}
console.log(suites.length + " browser runners, " + failed + " failed");
process.exitCode = failed ? 1 : 0;
