import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import { testUrl } from "./fixtures/single-store-expansion.mjs";

const target = testUrl(process.env.SINGLE_STORE_TEST_DATABASE_URL);
assert.equal(target.pathname, "/single_store_test_expansion_20261123");
const historicalVersions = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", "HEAD", "--", "supabase/migrations"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter((name) => /\/\d{14}_.+\.sql$/.test(name))
  .map((name) => name.split("/").at(-1).slice(0, 14))
  .filter((version) => version <= "20260922120000")
  .sort();
assert.equal(historicalVersions.length, 105);

async function fixture(versions) {
  const directory = await mkdtemp(join(resolve(".superpowers"), "gate-suite-head-"));
  assert.ok(resolve(directory).startsWith(`${resolve(".superpowers")}${sep}`));
  for (const path of [
    "scripts/single-store",
    "tests/database/fixtures",
    "supabase/migrations",
    ".superpowers",
  ]) {
    await mkdir(join(directory, path), { recursive: true });
  }
  for (const path of [
    "scripts/single-store/preflight.mjs",
    "scripts/single-store/preflight.sql",
    "scripts/single-store/check-migration-baseline.mjs",
    "tests/database/single-store-baseline-gate.test.mjs",
    "tests/database/fixtures/single-store-expansion.mjs",
  ])
    await copyFile(path, join(directory, path));
  for (const version of versions) {
    await writeFile(
      join(directory, "supabase/migrations", `${version}_fixture.sql`),
      "-- manifest fixture only\n",
    );
  }
  const git = (args) =>
    execFileSync("git", ["-C", directory, ...args], { stdio: "pipe" });
  git(["init", "--quiet"]);
  git(["add", "supabase/migrations", "scripts", "tests"]);
  git([
    "-c",
    "user.name=SQL fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "isolated gate suite HEAD fixture",
  ]);
  return directory;
}

// Run sequentially: these child suites deliberately share one guarded SQL
// fixture. Only temporary repositories get synthetic commits, never real HEAD.
for (const [name, suffix] of [
  ["historical HEAD with 105 migrations", []],
  ["committed expansion HEAD with 106 migrations", ["20261123120000"]],
  [
    "later committed suffix HEAD with 107 migrations",
    ["20261123120000", "20261124120000"],
  ],
]) {
  test(`gate suite passes under ${name}`, async () => {
    const directory = await fixture([...historicalVersions, ...suffix]);
    try {
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;
      const child = spawnSync(
        process.execPath,
        [
          "--test",
          "--test-reporter=tap",
          "tests/database/single-store-baseline-gate.test.mjs",
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: childEnv,
        },
      );
      assert.equal(child.status, 0, child.stdout + child.stderr);
      assert.match(child.stdout, /# tests 7\b/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
