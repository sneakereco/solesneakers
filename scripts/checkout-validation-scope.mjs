import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const full = { database: true, chromium: true };
const observerClockMigration =
  "supabase/migrations/20261127135000_analytics_observer_clock.sql";
const independentFiles = new Set([
  ".github/workflows/analytics-observers.yml",
  ".github/workflows/ci.yml",
  "scripts/checkout-validation-scope.mjs",
  "tests/operations/checkout-validation-scope.test.mjs",
  "tests/operations/ci-parallel-validation.test.mjs",
  "tests/database/migration-reconciliation.test.mjs",
  "tests/operations/fixtures/analytics-active-v1.sql",
  "scripts/analytics-endpoint-revisions.mjs",
  "scripts/analytics-native-readback.mjs",
  "scripts/check-analytics-deployment.mjs",
  "scripts/provision-admin-analytics.mjs",
  "scripts/refresh-admin-analytics.mjs",
  "scripts/resolve-analytics-observer-deployment.mjs",
  "scripts/resolve-analytics-observer-release.mjs",
  "scripts/run-admin-analytics-observers.mjs",
]);

const analyticsSource = "src/Modules/Analytics/Source/Features/";
const independentAnalytics =
  /^(?:Dashboard\/|Reporting\/|ReportContract\/|EventDelivery\/(?:behavior-archive|instant|observation-refresh|reconcile|reconciliation-evidence)\.ts$)/;

function isIndependent(path) {
  return (
    independentFiles.has(path) ||
    /\.md$/i.test(path) ||
    /^public\/.*\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(path) ||
    (path.startsWith(analyticsSource) &&
      independentAnalytics.test(path.slice(analyticsSource.length))) ||
    /^src\/Modules\/Analytics\/Tests\/Features\/(?:Dashboard|Reporting|ReportContract|EventDelivery)\//.test(
      path,
    ) ||
    /^src\/(?:app\/admin\/analytics|app\/api\/admin\/analytics)\//.test(path) ||
    /^tests\/operations\/admin-analytics-[a-z-]+\.test\.mjs$/.test(path)
  );
}

function isCheckoutBrowserOnly(path) {
  return (
    /^src\/components\/(?:cart|checkout)\/.*\.(?:tsx|css)$/.test(path) ||
    /^src\/Modules\/(?:Cart|Checkout)\/Tests\/.*\.browser(?:\.test)?\.mjs$/.test(path) ||
    /^tests\/browser\/checkout-[^/]+\.mjs$/.test(path)
  );
}

export function scope(paths) {
  let database = false;
  let chromium = false;
  for (const path of paths) {
    if (path === observerClockMigration) {
      database = true;
    } else if (isCheckoutBrowserOnly(path)) {
      chromium = true;
    } else if (!isIndependent(path)) {
      return full;
    }
  }
  return { database, chromium };
}

const commitSha = /^[0-9a-f]{40}$/;

function pullRequestPaths(eventPath) {
  const { pull_request: pr } = JSON.parse(readFileSync(eventPath, "utf8"));
  const base = pr?.base?.sha;
  const head = pr?.head?.sha;
  if (
    typeof base !== "string" ||
    typeof head !== "string" ||
    !commitSha.test(base) ||
    !commitSha.test(head)
  ) {
    throw new Error("Invalid pull request SHAs");
  }
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const mergeBase = git("merge-base", "--all", base, head).trim();
  if (!commitSha.test(mergeBase)) throw new Error("Missing or ambiguous merge base");

  // Treat renames as a deletion and an addition so both paths affect scope.
  const diff = git(
    "diff",
    "--no-ext-diff",
    "--name-only",
    "-z",
    "--no-renames",
    mergeBase,
    head,
    "--",
  );
  if (!diff) return [];
  if (!diff.endsWith("\0")) throw new Error("Incomplete changed path list");
  return diff.slice(0, -1).split("\0");
}

if (import.meta.main) {
  let result = full;
  let reason = "full validation for this event";
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    try {
      const paths = pullRequestPaths(process.env.GITHUB_EVENT_PATH);
      result = scope(paths);
      reason = `classified ${paths.length} changed paths`;
    } catch {
      reason = "full validation because the pull request diff was unavailable";
    }
  }
  const outputs = `database=${result.database}\nchromium=${result.chromium}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  console.log(
    `Checkout validation (${reason}): database=${result.database}, chromium=${result.chromium}`,
  );
}
