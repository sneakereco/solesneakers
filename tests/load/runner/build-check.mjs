import { readFile, mkdir, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { manifestDigest } from "../shared/contracts.mjs";
const mode = process.argv[2];
if (!["disabled", "isolated"].includes(mode))
  throw Error("Select disabled or isolated build mode");
const workflow = await readFile(".github/workflows/ci.yml", "utf8"),
  stubs = Object.fromEntries(
    [...workflow.matchAll(/^      ([A-Z][A-Z0-9_]+): (.+)$/gm)].map((match) => [
      match[1],
      match[2].replace(/^"|"$/g, ""),
    ]),
  );
const artifactDir = resolve(
  ".superpowers/sdd/2026-11-25-black-friday-hybrid-load-testing",
);
await mkdir(artifactDir, { recursive: true });
const log = await open(join(artifactDir, `build-${mode}.log`), "w");
const env = {
  ...process.env,
  ...stubs,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_POSTHOG_ENABLED: "false",
  LOAD_TEST_ENABLED: "false",
};
if (mode === "isolated") {
  const manifest = JSON.parse(
    await readFile("tests/load/config/staging.example.json", "utf8"),
  );
  Object.assign(env, {
    LOAD_TEST_ENABLED: "true",
    LOAD_TEST_ALLOWED_PROJECT_ID: manifest.expected.projectId,
    LOAD_TEST_SIGNING_KEY: "local-build-placeholder-key-at-least-32-chars",
    LOAD_TEST_RESOURCE_MANIFEST: JSON.stringify(manifest),
    LOAD_TEST_RESOURCE_MANIFEST_SHA256: manifestDigest(manifest),
    VERCEL_PROJECT_ID: manifest.expected.projectId,
    VERCEL_DEPLOYMENT_ID: manifest.expected.deploymentId,
    VERCEL_GIT_COMMIT_SHA: manifest.expected.commit,
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: manifest.resources.supabase.url,
    UPSTASH_REDIS_REST_URL: manifest.resources.redis.url,
  });
}
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  env,
  shell: false,
  windowsHide: true,
  stdio: ["ignore", log.fd, log.fd],
});
const code = await new Promise((done, fail) => {
  child.once("error", fail);
  child.once("exit", done);
});
await log.close();
console.log(
  `Production build (${mode}): exit ${code}; ${join(artifactDir, `build-${mode}.log`)}`,
);
process.exitCode = code ?? 1;
