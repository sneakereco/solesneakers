import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { startLocalAcceptance } from "./helpers/local-next-acceptance.mjs";

// This defensive regression can create and change only its own disposable LOCAL users.
const root = process.cwd();
const backendOrigin = "http://127.0.0.1:64331";
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, backendOrigin);
assert.ok(process.env.SUPABASE_SECRET_KEY, "Local fixture key is required");
const run = randomUUID();
const runtime = resolve(root, "test-results/ux-implementation/ownership-runtime-" + run);
assert.ok(
  runtime.startsWith(resolve(root, "test-results/ux-implementation") + "/") ||
    runtime.startsWith(resolve(root, "test-results/ux-implementation") + "\\"),
);
mkdirSync(runtime, { recursive: true });
cpSync(join(root, "src"), join(runtime, "src"), {
  recursive: true,
  filter(path) {
    assert.equal(
      lstatSync(path).isSymbolicLink(),
      false,
      "Source copy must not follow links",
    );
    return true;
  },
});
for (const file of [
  "package.json",
  "next.config.ts",
  "tsconfig.json",
  "next-env.d.ts",
  "postcss.config.js",
  "tailwind.config.ts",
]) {
  cpSync(join(root, file), join(runtime, file));
}
const dependencyLink = join(runtime, "node_modules");
symlinkSync(join(root, "node_modules"), dependencyLink, "junction");
const routePath = "src/app/api/auth/update-password/route.ts";
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(hash(join(runtime, routePath)), hash(join(root, routePath)));
const sourceHead = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
}).stdout.trim();
const backend = createClient(backendOrigin, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const created = [];
let app, browser;
const evidence = {
  sourceHead,
  routeSha256: hash(join(runtime, routePath)),
  localOnly: true,
  fixtures: [],
  checks: {},
  runtime: relative(root, runtime),
};
function data(result) {
  if (result.error)
    throw Error("Disposable local fixture operation failed: " + result.error.message);
  return result.data;
}
async function fixture(tenant) {
  const email = "ux-owner-" + randomUUID() + "@example.test";
  const password = randomUUID() + "aA!9";
  const { user } = data(
    await backend.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  assert.equal(user.email, email);
  created.push(user.id);
  data(
    await backend
      .from("profiles")
      .upsert({ id: user.id, email, role: "customer", tenant_id: tenant }),
  );
  return { id: user.id, email, password };
}
async function post(context, path, body) {
  return context.request.post(app.origin + path, {
    data: body,
    headers: { Origin: app.origin },
  });
}
try {
  process.chdir(runtime);
  app = await startLocalAcceptance();
  assert.equal(new URL(app.origin).hostname, "127.0.0.1");
  const tenant = data(await backend.from("tenants").select("id").limit(1).single()).id;
  const owner = await fixture(tenant);
  const other = await fixture(tenant);
  evidence.fixtures = [owner.id, other.id];
  browser = await chromium.launch();
  const ownerContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const { properties } = data(
    await backend.auth.admin.generateLink({ type: "recovery", email: owner.email }),
  );
  const verify = await post(ownerContext, "/api/auth/forgot-password/verify-code", {
    email: owner.email,
    code: properties.email_otp,
  });
  assert.equal(verify.status(), 200);
  const recoveryOwnerId = (await verify.json()).recoveryOwnerId;
  assert.equal(recoveryOwnerId, owner.id);
  evidence.checks.serverReturnedVerifiedOwner = true;
  const login = await post(otherContext, "/api/auth/login", {
    email: other.email,
    password: other.password,
  });
  assert.equal(login.status(), 200);
  const session = await otherContext.request.get(app.origin + "/api/auth/session");
  assert.equal((await session.json()).user.id, other.id);
  const rejected = await post(otherContext, "/api/auth/update-password", {
    recoveryOwnerId,
    password: randomUUID() + "aA!9",
  });
  assert.equal(rejected.status(), 409);
  assert.equal((await rejected.json()).ok, false);
  evidence.checks.otherFixtureOwnerRejected409 = true;
  const check = createClient(
    backendOrigin,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const unchanged = await check.auth.signInWithPassword({
    email: other.email,
    password: other.password,
  });
  assert.equal(unchanged.error, null);
  assert.equal(unchanged.data.user.id, other.id);
  evidence.checks.otherFixturePasswordUnchanged = true;
  await check.auth.signOut();
  console.log(
    "PASS actual local recovery owner DTO, mismatched disposable cookie rejected409, and unchanged fixture password",
  );
} finally {
  const cleanup = [];
  const cleanupErrors = [];
  if (browser)
    await browser.close().catch(() => cleanupErrors.push("Browser cleanup failed"));
  for (const id of created) {
    try {
      const removed = await backend.auth.admin.deleteUser(id);
      const remaining = await backend.from("profiles").select("id").eq("id", id);
      const user = await backend.auth.admin.getUserById(id);
      cleanup.push({
        id,
        deleted: !removed.error,
        profileAbsent: !remaining.error && remaining.data.length === 0,
        authAbsent: user.error?.status === 404 && !user.data.user,
      });
    } catch {
      cleanupErrors.push("Exact-ID fixture cleanup failed: " + id);
    }
  }
  evidence.cleanup = cleanup;
  if (app) await app.close().catch(() => cleanupErrors.push("Server cleanup failed"));
  process.chdir(root);
  assert.ok(lstatSync(dependencyLink).isSymbolicLink());
  unlinkSync(dependencyLink); // Remove only our link, never its shared target.
  evidence.dependencyLinkRemoved = true;
  assert.equal(lstatSync(runtime).isSymbolicLink(), false);
  assert.equal(realpathSync(runtime).toLowerCase(), runtime.toLowerCase());
  assert.ok(
    relative(resolve(root, "test-results/ux-implementation"), runtime).startsWith(
      "ownership-runtime-",
    ),
  );
  rmSync(runtime, { recursive: true, force: true }); // Checked exact owned directory, after removing its dependency link.
  evidence.runtimeRemoved = true;
  evidence.cleanupErrors = cleanupErrors;
  mkdirSync(join(root, "test-results/ux-implementation"), { recursive: true });
  writeFileSync(
    join(root, "test-results/ux-implementation/local-recovery-owner-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  assert.equal(cleanup.length, created.length);
  assert.ok(
    cleanup.every((item) => item.deleted && item.profileAbsent && item.authAbsent),
  );
  assert.deepEqual(cleanupErrors, []);
  console.log(
    `Cleaned ${created.length} exact-ID disposable local users, profiles, browser, server, dependency link and isolated runtime`,
  );
}
