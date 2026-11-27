import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/check-analytics-deployment.mjs");
const project = "phc_syntheticownerproject1234567";
const build = {
  NEXT_PUBLIC_POSTHOG_ENABLED: "true",
  NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: "staging",
  NEXT_PUBLIC_POSTHOG_PROJECT_KEY: project,
  NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
  POSTHOG_API_HOST: "https://us.posthog.com",
  POSTHOG_PROJECT_ID: "741",
  POSTHOG_QUERY_API_KEY: "synthetic-private-read-key",
  ANALYTICS_IDENTITY_SECRET: "synthetic-private-identity",
  ANALYTICS_VERIFIED_PAIRING: createHash("sha256")
    .update(
      JSON.stringify([
        "staging",
        "https://us.posthog.com",
        "741",
        "https://us.i.posthog.com",
        project,
      ]),
    )
    .digest("hex"),
};
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "analytics-deployment-"));
  mkdirSync(join(dir, ".vercel"));
});
afterAll(() => {
  unlinkSync(join(dir, ".vercel", ".env.production.local"));
  rmdirSync(join(dir, ".vercel"));
  rmdirSync(dir);
});
function run(
  settings: Record<string, string>,
  runtime: Record<string, string>,
  environment = "staging",
) {
  writeFileSync(
    join(dir, ".vercel", ".env.production.local"),
    Object.entries(runtime)
      .map(([name, value]) => name + "=" + value)
      .join("\n"),
  );
  const result = spawnSync(process.execPath, [script, environment], {
    cwd: dir,
    env: { NODE_ENV: "test", SystemRoot: process.env.SystemRoot, ...settings },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  expect(result.stdout + result.stderr).not.toMatch(/synthetic-private|phc_synthetic/);
  return result.status;
}
it("accepts matching enabled build and runtime", () => expect(run(build, build)).toBe(0));
it.each([
  ["NEXT_PUBLIC_POSTHOG_ENABLED", "false"],
  ["NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT", "production"],
  ["NEXT_PUBLIC_POSTHOG_PROJECT_KEY", "phc_syntheticotherproject7654321"],
  ["NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com"],
  ["POSTHOG_QUERY_API_KEY", "synthetic-private-different"],
  ["POSTHOG_OPERATOR_API_KEY", "synthetic-private-operator"],
])("rejects a mismatched or forbidden runtime %s", (name, value) => {
  expect(run(build, { ...build, [name]: value })).toBe(1);
});
const disabled = { NEXT_PUBLIC_POSTHOG_ENABLED: "false" };
it("accepts an explicitly disabled build and a disabled or unconfigured runtime", () => {
  expect(run(disabled, disabled)).toBe(0);
  expect(run(disabled, {})).toBe(0);
});
it("rejects a disabled build paired with an enabled runtime", () => {
  expect(run(disabled, build)).toBe(1);
});
it("rejects enabled build with missing runtime flag", () => {
  const runtime: Record<string, string> = { ...build };
  delete runtime.NEXT_PUBLIC_POSTHOG_ENABLED;
  expect(run(build, runtime)).toBe(1);
});
it("rejects malformed flags in either source", () => {
  expect(run({ NEXT_PUBLIC_POSTHOG_ENABLED: "TRUE" }, disabled)).toBe(1);
  expect(run(disabled, { NEXT_PUBLIC_POSTHOG_ENABLED: "off" })).toBe(1);
});

it("keeps an unconfigured production deployment off", () => {
  expect(run({}, {}, "production")).toBe(0);
  expect(run({}, disabled, "production")).toBe(0);
  expect(run({}, build, "production")).toBe(1);
});
it("mirrors the production workflow's disabled fallback for incomplete public configuration", () => {
  const partial = {
    NEXT_PUBLIC_POSTHOG_ENABLED: "true",
    NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: "production",
  };
  expect(run(partial, {}, "production")).toBe(0);
  expect(run(partial, disabled, "production")).toBe(0);
  expect(run(partial, build, "production")).toBe(1);
  expect(run({ NEXT_PUBLIC_POSTHOG_ENABLED: "tru" }, {}, "production")).toBe(1);
  expect(run({}, {}, "staging")).toBe(1);
});
