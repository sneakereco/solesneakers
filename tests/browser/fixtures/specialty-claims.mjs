import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { build } from "esbuild";
import { EncryptJWT } from "jose";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import {
  testUrl,
  prepareTestDatabase,
  applySpecialtyMigrations,
  seedActor,
  seedPrize,
} from "../../database/fixtures/specialty-claims.mjs";
import { startLocalSpecialtyServices } from "./local-services.mjs";
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const execute = promisify(execFile);
const sleep = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
let active = null;
export function assertBrowserTestTarget(origin, databaseUrl) {
  const url = new URL(origin);
  assert.ok(
    url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname),
    "Browser fixtures require a loopback HTTP origin.",
  );
  assert.ok(
    Number(url.port) >= 1024 && Number(url.port) <= 65535,
    "Select an explicit unprivileged test port.",
  );
  assert.ok(
    !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
    "Use an origin without credentials, path, query, or fragment.",
  );
  testUrl(databaseUrl);
}
async function assertFreeAppPort(port) {
  const socket = createServer();
  await new Promise((resolveWait, reject) => {
    socket.once("error", reject);
    socket.listen(port, "127.0.0.1", resolveWait);
  });
  await new Promise((resolveWait) => socket.close(resolveWait));
}
async function removePrivateDirectory(path, runId) {
  const root = await realpath(repoRoot),
    parent = await realpath(resolve(repoRoot, "test-results/specialty/.private"));
  const target = await realpath(path);
  assert.ok(parent.startsWith(root + sep));
  assert.equal(
    target,
    join(parent, runId),
    "Refusing cleanup outside the owned private run directory.",
  );
  await rm(target, { recursive: true, force: true });
}
export async function startBrowserTestApp(
  origin,
  { beforeStart, startNext = true } = {},
) {
  assert.equal(active, null, "A browser fixture app is already running.");
  const databaseUrl = String(testUrl());
  assertBrowserTestTarget(origin, databaseUrl);
  await assertFreeAppPort(Number(new URL(origin).port));
  const runId = randomUUID(),
    privateDir = resolve(repoRoot, "test-results/specialty/.private", runId);
  await mkdir(privateDir, { recursive: true });
  const state = {
    runId,
    origin: new URL(origin).origin,
    privateDir,
    databaseUrl,
    secret: randomBytes(32).toString("hex"),
    adminSecret: randomBytes(32),
    campaignSlug: "black-friday-2026-load-" + runId,
    runs: new Map(),
    ordinary: [],
    actors: [],
    stopped: false,
  };
  active = state;
  try {
    state.db = await prepareTestDatabase();
    await applySpecialtyMigrations(state.db);
    const actor = await seedActor(state.db);
    state.adminId = actor.actor;
    state.owner = actor.owner;
    const customer = await seedActor(state.db);
    state.customerId = customer.actor;
    state.actors = [state.adminId, state.customerId];
    for (const [id, role] of [
      [state.adminId, "admin"],
      [state.customerId, "customer"],
    ])
      await state.db.query(
        "insert into public.profiles(id,email,role,tenant_id) values($1,$2,$3,$4) on conflict(id) do update set role=excluded.role,tenant_id=excluded.tenant_id",
        [id, "fixture-" + id + "@example.invalid", role, state.owner],
      );
    const helper = await build({
      stdin: {
        resolveDir: repoRoot,
        contents: `
      export {getIdentityKeyFingerprint,deriveEligibilityKeys,normalizeInstagramHandle,canonicalAddressIdentity,fingerprintInput,fingerprintSubmission,hashRecoverySecret} from "./src/Modules/SpecialtyProducts/Source/Features/Claim/normalize-identity";
      export {signBrowserCookie} from "./src/Modules/SpecialtyProducts/Source/Features/RequestProtection/claim-protection";
      export {validateEligibilityHandler} from "./src/Modules/SpecialtyProducts/Source/Features/ValidateEligibility/validate-eligibility-handler";
      export {issueEligibilityToken} from "./src/Modules/SpecialtyProducts/Source/Features/Claim/validation-token";
    `,
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      packages: "external",
    });
    const helperPath = join(privateDir, "server-helpers.cjs");
    await writeFile(helperPath, helper.outputFiles[0].contents, { mode: 0o600 });
    state.helpers = createRequire(import.meta.url)(helperPath);
    state.campaignId = (
      await state.db.query(
        "insert into public.specialty_campaigns(slug) values($1) returning id",
        [state.campaignSlug],
      )
    ).rows[0].id;
    await state.db.query(
      "select public.set_specialty_campaign_enabled($1,true,1,$2,$3)",
      [
        state.campaignId,
        state.adminId,
        state.helpers.getIdentityKeyFingerprint(state.secret),
      ],
    );
    const users = new Map(
      state.actors.map((id) => [
        id,
        {
          id,
          aud: "authenticated",
          role: "authenticated",
          email: "fixture-" + id + "@example.invalid",
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      ]),
    );
    state.services = await startLocalSpecialtyServices({
      runId,
      databaseUrl,
      privateDir,
      appOrigin: state.origin,
      users,
    });
    const redis = new Redis({
      url: state.services.redisUrl,
      token: state.services.redisToken,
    });
    assert.equal(await redis.ping(), "PONG");
    const limitProbe = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(2, "1 m"),
      prefix: "fixture:" + runId,
    });
    assert.equal((await limitProbe.limit("probe")).success, true);
    assert.equal((await limitProbe.limit("probe")).success, true);
    assert.equal((await limitProbe.limit("probe")).success, false);
    await seedOrdinaryCatalog(state);
    state.probe = await seedBrowserPrize(runId, 1);
    if (!startNext && !beforeStart) return state;
    const childEnv = {
      ...process.env,
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: state.services.origin,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: state.services.anonymousKey,
      SUPABASE_SECRET_KEY: state.services.serviceKey,
      SUPABASE_DB_URL: databaseUrl,
      SHIPPO_API_TOKEN: "fixture-not-a-provider-token",
      SHIPPO_WEBHOOK_TOKEN: "fixture",
      UPSTASH_REDIS_REST_URL: state.services.redisUrl,
      UPSTASH_REDIS_REST_TOKEN: state.services.redisToken,
      SES_SMTP_HOST: "127.0.0.1",
      SES_SMTP_USER: "fixture",
      SES_SMTP_PASS: "fixture",
      ADMIN_SESSION_SECRET: state.adminSecret.toString("base64"),
      ORDER_ACCESS_TOKEN_SECRET: randomBytes(32).toString("hex"),
      CHECKOUT_IDENTITY_HMAC_SECRET: randomBytes(32).toString("hex"),
      SPECIALTY_CLAIMS_SECRET: state.secret,
      SPECIALTY_CAMPAIGN_SLUG: state.campaignSlug,
      NEXT_PUBLIC_SITE_URL: state.origin,
      SQUARE_ENVIRONMENT: "sandbox",
      SQUARE_APPLICATION_ID: "fixture",
      SQUARE_ACCESS_TOKEN: "fixture",
      SQUARE_LOCATION_ID: "fixture",
      NEXT_PUBLIC_POSTHOG_ENABLED: "false",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
    };
    // Optional empty public settings fail validation; omit them entirely in this isolated app.
    delete childEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    await beforeStart?.(childEnv);
    if (!startNext) return state;
    const output = createWriteStream(join(privateDir, "next.log"), { mode: 0o600 });
    state.output = output;
    state.child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        new URL(origin).port,
      ],
      {
        cwd: repoRoot,
        env: childEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    state.child.stdout.pipe(output);
    state.child.stderr.pipe(output);
    state.child.on("error", () => {});
    let ready = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      if (state.child.exitCode !== null)
        throw new Error("The isolated Next app exited. Inspect its private local log.");
      try {
        const response = await fetch(state.origin + "/api/specialty/discovery", {
          signal: AbortSignal.timeout(2000),
        });
        const data = await response.json();
        if (
          response.ok &&
          data.products?.some((product) => product.id === state.probe.productId)
        ) {
          ready = true;
          break;
        }
      } catch {
        /* Wait for compilation and the owned project data. */
      }
      await sleep(500);
    }
    assert.ok(ready, "The isolated app did not expose its owned fixture campaign.");
    // Compile the private route modules without validating or submitting a claim.
    for (const path of [
      "/api/specialty/eligibility",
      "/api/specialty/claims",
      "/api/specialty/claims/result",
    ]) {
      const response = await fetch(state.origin + path, {
        signal: AbortSignal.timeout(60000),
      });
      assert.equal(response.status, 405);
      await response.body?.cancel();
    }
    return state;
  } catch (error) {
    let diagnostic = await readFile(join(privateDir, "next.log"), "utf8").catch(() => "");
    for (const value of [
      state.secret,
      state.adminSecret.toString("base64"),
      state.services?.serviceKey,
      state.services?.redisToken,
    ])
      if (value) diagnostic = diagnostic.replaceAll(value, "[redacted]");
    await stopBrowserTestApp();
    throw new Error(
      "Isolated app setup failed: " +
        error.message +
        (diagnostic ? "\n" + diagnostic.slice(-4000) : ""),
    );
  }
}
async function seedOrdinaryCatalog(state) {
  const brand = (
    await state.db.query(
      "insert into public.tag_brands(canonical_label) values($1) returning id",
      ["Browser fixture " + state.runId],
    )
  ).rows[0].id;
  state.brandId = brand;
  for (const category of ["accessories", "clothing"]) {
    const sizeType = category === "clothing" ? "clothing" : "none";
    const size = (
      await state.db.query(
        "insert into public.tag_sizes(size_type,canonical_label) values($1,$2) returning id",
        [sizeType, "Browser " + category + " " + state.runId],
      )
    ).rows[0].id;
    const product = (
      await state.db.query(
        "insert into public.products(tenant_id,name,condition,category,brand_id,size_type,go_live_at) values($1,$2,'new',$3,$4,$5,now()-interval '1 day') returning id",
        [state.owner, "Browser ordinary " + category, category, brand, sizeType],
      )
    ).rows[0].id;
    const entry = { productId: product, sizeId: size, category };
    state.ordinary.push(entry);
    const variant = (
      await state.db.query(
        "insert into public.product_variants(tenant_id,product_id,size_id,sku,sale_price_cents,stock,unit_cost_cents) values($1,$2,$3,$4,10000,5,5000) returning id",
        [state.owner, product, size, "browser-" + randomUUID()],
      )
    ).rows[0].id;
    entry.variantId = variant;
    if (category === "accessories")
      await state.db.query(
        "insert into public.featured_items(product_id,sort_order,tenant_id) values($1,0,null)",
        [product],
      );
  }
}
export async function seedBrowserPrize(runId, quantity) {
  assert.match(runId, /^[a-f0-9-]{36}$/);
  assert.ok(active, "Start the guarded fixture app first.");
  const prize = await seedPrize(active.db, {
    quantity,
    campaignSlug: active.campaignSlug,
  });
  active.actors.push(prize.actor);
  const list = active.runs.get(runId) ?? [];
  list.push(prize);
  active.runs.set(runId, list);
  const input = {
    ...prize.input,
    mode: "update",
    expectedRevision: 1,
    name: "Browser specialty prize",
    instructions: "Keep this confirmation. The reseller will contact you on Instagram.",
  };
  delete input.quantity;
  const updated = (
    await active.db.query(
      "select public.save_specialty_product($1,$2::jsonb,$3,$4) result",
      [prize.productId, JSON.stringify(input), prize.actor, prize.owner],
    )
  ).rows[0].result;
  return { ...prize, ...updated };
}
export async function readBrowserRunState(runId) {
  assert.ok(active?.runs.has(runId), "Unknown browser fixture run.");
  const ids = active.runs.get(runId).map((prize) => prize.productId);
  return (
    await active.db.query(
      `select
    (select count(*)::int from public.specialty_claims where product_id=any($1::uuid[])) "winningClaims",
    (select coalesce(sum(stock),0)::int from public.product_variants where product_id=any($1::uuid[])) "remainingStock",
    (select count(*)::int from public.order_items where product_id=any($1::uuid[])) "ordinaryPrizeOrderItems"`,
      [ids],
    )
  ).rows[0];
}
export async function addFixtureBrowserCookies(context, role = "guest") {
  assert.ok(active);
  const browserId = randomUUID(),
    domain = new URL(active.origin).hostname;
  await context.addCookies([
    {
      name: "specialty_browser",
      value: active.helpers.signBrowserCookie(
        browserId,
        Date.now(),
        active.adminSecret.toString("base64"),
      ),
      domain,
      path: "/api/specialty",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  if (role !== "guest") {
    const id = role === "admin" ? active.adminId : active.customerId;
    const accessToken = active.services.tokenForUser(id),
      now = Math.floor(Date.now() / 1000);
    const session = {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 28800,
      expires_at: now + 28800,
      refresh_token: "fixture-refresh-" + id,
      user: {
        id,
        email: "fixture-" + id + "@example.invalid",
        app_metadata: { provider: "email" },
        user_metadata: {},
      },
    };
    await context.addCookies([
      {
        name: "sb-127-auth-token",
        value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
        domain,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    if (role === "admin") {
      const token = await new EncryptJWT({ v: 1, sub: id })
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuedAt()
        .setExpirationTime("8h")
        .encrypt(active.adminSecret);
      await context.addCookies([
        {
          name: "admin_session",
          value: token,
          domain,
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    }
  }
  return browserId;
}
export async function fixtureEligibilityResponse(input, browserId) {
  assert.ok(active);
  const owned = [...active.runs.values()]
    .flat()
    .some((prize) => prize.productId === input.productId);
  assert.ok(owned, "Cannot sign eligibility for an unowned prize.");
  return active.helpers.validateEligibilityHandler(
    new Request(active.origin + "/api/specialty/eligibility", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    {
      getContext: async () => ({
        campaignId: active.campaignId,
        productId: input.productId,
        browserId,
        normalizationVersion: 1,
        identityKeyFingerprint: active.helpers.getIdentityKeyFingerprint(active.secret),
      }),
      protect: async () => ({ allowed: true }),
      secret: () => active.secret,
      nowMs: Date.now,
      validateAddress: async (address) => {
        const [line1, unit, city, state, postalCode] = JSON.parse(
          active.helpers.canonicalAddressIdentity(address),
        );
        return {
          status: "valid",
          address: {
            line1,
            line2: unit ? "UNIT " + unit : null,
            city,
            state,
            postalCode,
            country: "US",
          },
        };
      },
    },
  );
}
export async function stopBrowserTestTransports() {
  const state = active;
  if (!state || state.transportsStopped) return;
  if (state.child?.pid && state.child.exitCode === null) {
    if (process.platform === "win32")
      await execute("taskkill", ["/PID", String(state.child.pid), "/T", "/F"], {
        windowsHide: true,
      }).catch(() => {});
    else state.child.kill("SIGTERM");
  }
  state.output?.end();
  await state.services?.stop();
  state.transportsStopped = true;
}
export async function stopBrowserTestApp() {
  const state = active;
  if (!state || state.stopped) return;
  state.stopped = true;
  await stopBrowserTestTransports();
  if (state.db) {
    try {
      const ids = [...state.runs.values()].flat().map((prize) => prize.productId);
      if (state.campaignId) {
        const marker = (
          await state.db.query(
            "select slug from public.specialty_campaigns where id=$1",
            [state.campaignId],
          )
        ).rows[0]?.slug;
        assert.equal(
          marker,
          state.campaignSlug,
          "Refusing fixture cleanup of another campaign.",
        );
        await state.db.query(
          "delete from public.specialty_claim_attempts where campaign_id=$1",
          [state.campaignId],
        );
        await state.db.query("delete from public.specialty_claims where campaign_id=$1", [
          state.campaignId,
        ]);
        await state.db.query(
          "delete from public.specialty_product_config where campaign_id=$1",
          [state.campaignId],
        );
        await state.db.query("delete from public.products where id=any($1::uuid[])", [
          ids,
        ]);
        await state.db.query("delete from public.specialty_campaigns where id=$1", [
          state.campaignId,
        ]);
      }
      const ordinaryIds = state.ordinary.map((item) => item.productId);
      await state.db.query(
        "delete from public.featured_items where product_id=any($1::uuid[])",
        [ordinaryIds],
      );
      await state.db.query("delete from public.products where id=any($1::uuid[])", [
        ordinaryIds,
      ]);
      await state.db.query("delete from public.tag_sizes where id=any($1::uuid[])", [
        state.ordinary.map((item) => item.sizeId),
      ]);
      if (state.brandId)
        await state.db.query("delete from public.tag_brands where id=$1", [
          state.brandId,
        ]);
      await state.db.query("delete from public.profiles where id=any($1::uuid[])", [
        state.actors,
      ]);
      await state.db.query("delete from auth.users where id=any($1::uuid[])", [
        state.actors,
      ]);
    } finally {
      await state.db.end();
    }
  }
  await removePrivateDirectory(state.privateDir, state.runId);
  active = null;
}
