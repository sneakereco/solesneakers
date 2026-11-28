import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { scope } from "../../scripts/checkout-validation-scope.mjs";

const cases = [
  ["docs/operations/admin-analytics.md", false, false],
  ["public/lookbook.webp", false, false],
  ["src/Modules/Analytics/Source/Features/Reporting/report-store.ts", false, false],
  [
    "src/Modules/Analytics/Source/Features/EventDelivery/observation-refresh.ts",
    false,
    false,
  ],
  ["src/Modules/Analytics/Tests/Features/Reporting/report-cache.test.ts", false, false],
  ["src/app/admin/analytics/page.tsx", false, false],
  ["scripts/run-admin-analytics-observers.mjs", false, false],
  [".github/workflows/ci.yml", false, false],
  ["scripts/checkout-validation-scope.mjs", false, false],
  ["tests/operations/checkout-validation-scope.test.mjs", false, false],
  ["tests/database/migration-reconciliation.test.mjs", false, false],
  ["src/Modules/Analytics/Source/Features/CommerceFacts/repository.ts", true, true],
  ["src/Modules/Analytics/Source/Features/EventDelivery/delivery-runtime.ts", true, true],
  ["src/Modules/Checkout/Source/Features/Payments/dispatch-payment.ts", true, true],
  ["src/app/api/cart/validate/route.ts", true, true],
  ["src/app/checkout/page.tsx", true, true],
  ["src/components/checkout/CheckoutPaymentPanel.tsx", false, true],
  ["src/components/checkout/checkout.css", false, true],
  ["tests/browser/checkout-hardening.mjs", false, true],
  ["supabase/migrations/20261127135000_analytics_observer_clock.sql", true, false],
  ["supabase/migrations/20261127140000_analytics_observer_clock.sql", true, true],
  ["src/app/layout.tsx", true, true],
  ["src/lib/square/client.ts", true, true],
  ["package-lock.json", true, true],
  ["scripts/new-runtime.mjs", true, true],
];

for (const [path, database, chromium] of cases) {
  test(`classifies ${path}`, () => {
    assert.deepEqual(scope([path]), { database, chromium });
  });
}

test("combines the independent database and browser requirements", () => {
  assert.deepEqual(
    scope([
      "supabase/migrations/20261127135000_analytics_observer_clock.sql",
      "src/components/checkout/checkout.css",
    ]),
    { database: true, chromium: true },
  );
});

const script = fileURLToPath(
  new URL("../../scripts/checkout-validation-scope.mjs", import.meta.url),
);
const full = "database=true\nchromium=true\n";
const skipped = "database=false\nchromium=false\n";

test("uses the whole PR diff and includes the old path of renamed files", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "checkout-validation-scope-"));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("checkout-validation-scope-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  const eventPath = join(directory, "event.json");
  const outputPath = join(directory, "outputs");
  const run = (base, head, eventName = "pull_request") => {
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }),
    );
    writeFileSync(outputPath, "");
    execFileSync(process.execPath, [script], {
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_OUTPUT: outputPath,
      },
    });
    return readFileSync(outputPath, "utf8");
  };
  const commit = (message) => {
    git(
      "-c",
      "user.name=CI",
      "-c",
      "user.email=ci@example.invalid",
      "commit",
      "-qm",
      message,
    );
    return git("rev-parse", "HEAD");
  };

  git("init", "-q");
  writeFileSync(join(directory, "checkout.ts"), "export const checkout = true;\n");
  git("add", "checkout.ts");
  const base = commit("Add checkout");
  writeFileSync(join(directory, "report.md"), "Report notes\n");
  git("add", "report.md");
  const report = commit("Add notes");
  assert.equal(run(base, report), skipped);
  git("mv", "checkout.ts", "reference.md");
  commit("Rename checkout");
  writeFileSync(join(directory, "report.md"), "Updated report notes\n");
  git("add", "report.md");
  const head = commit("Update notes");
  assert.equal(run(base, head), full);
  assert.equal(run("1".repeat(40), report), full);
  assert.equal(run("HEAD", report), full);
  assert.equal(run(base, report, "workflow_dispatch"), full);
  assert.equal(run(base, report, "merge_group"), full);
});
