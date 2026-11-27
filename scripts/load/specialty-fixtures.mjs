import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  startBrowserTestApp,
  stopBrowserTestApp,
  seedBrowserPrize,
  assertBrowserTestTarget,
  stopBrowserTestTransports,
} from "../../tests/browser/fixtures/specialty-claims.mjs";
const owned = new WeakMap();
const scenarios = new Set([
  "hot-one",
  "hot-many",
  "multi-product",
  "duplicate-address",
  "duplicate-instagram",
  "replayed-attempt",
  "lost-response",
  "overload",
  "shared-ip",
]);
export async function assertLoadTarget(options) {
  assert.equal(
    options.target,
    "local",
    "Hosted staging qualification is pending an explicitly permitted deployment, matching project/database marker, configured synthetic campaign and supported bot-test setup; no hosted mutation is attempted.",
  );
  assert.equal(options.project, "specialty-local", "Unexpected project.");
  assert.ok(
    !options.productIds,
    "Only newly generated synthetic prizes may be targeted.",
  );
  assertBrowserTestTarget(options.origin, options.databaseUrl);
}
export function validateManifestIdentity(manifest, expected) {
  assert.deepEqual(manifest, expected, "Run manifest changed; cleanup refused.");
  assert.match(manifest.runId, /^[a-f0-9-]{36}$/);
  assert.equal(manifest.marker, "sole-specialty-load-v1");
  assert.equal(manifest.campaignSlug, "black-friday-2026-load-" + manifest.runId);
  assert.ok(
    manifest.privateCredentialFile
      .replaceAll("\\", "/")
      .includes("/" + manifest.runId + "/actors.json"),
  );
}
export function validateCredentialArtifact(manifest, raw) {
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    manifest.credentialsSha256,
    "Private credential artifact changed.",
  );
  const actors = JSON.parse(raw);
  assert.equal(actors.length, manifest.requestCount);
  assert.ok(
    actors.every((actor) => manifest.productIds.includes(actor.payload?.productId)),
    "Unowned prize in credential artifact.",
  );
  return actors;
}
export async function prepareSpecialtyLoadRun(options) {
  const settings = {
    target: "local",
    origin: "http://localhost:3000",
    project: "specialty-local",
    databaseUrl: process.env.SPECIALTY_TEST_DATABASE_URL,
    ...options,
  };
  await assertLoadTarget(settings);
  assert.ok(scenarios.has(settings.scenario));
  assert.equal(settings.concurrency, 1000, "Qualification requires 1000 submissions.");
  assert.ok(
    ["protected", "award-rpc"].includes(settings.mode ?? "protected"),
    "Unknown qualification mode.",
  );
  const app = await startBrowserTestApp(settings.origin, {
    startNext: settings.mode !== "award-rpc",
  });
  try {
    const multi = ["multi-product", "duplicate-address", "duplicate-instagram"].includes(
      settings.scenario,
    );
    const quantity =
      settings.scenario === "hot-many" || settings.scenario === "multi-product"
        ? 10
        : settings.scenario.startsWith("duplicate-")
          ? 100
          : 1;
    const prizes = [];
    // The readiness probe stays unclaimed and is excluded from measured inventory.
    for (let i = 0; i < (multi ? 10 : 1); i++)
      prizes.push(await seedBrowserPrize(randomUUID(), quantity));
    const manifest = {
      runId: app.runId,
      target: "local",
      origin: app.origin,
      project: "specialty-local",
      databaseIdentity: new URL(app.databaseUrl).pathname.slice(1),
      campaignSlug: app.campaignSlug,
      campaignId: app.campaignId,
      productIds: prizes.map((p) => p.productId),
      marker: "sole-specialty-load-v1",
      privateCredentialFile: join(app.privateDir, "actors.json"),
      scenario: settings.scenario,
      mode: settings.mode ?? "protected",
      requestCount: 1000,
      actorCount: settings.scenario === "replayed-attempt" ? 1 : 1000,
      initialStock: prizes.length * quantity,
      expectedWinners: settings.scenario.startsWith("duplicate-")
        ? 1
        : prizes.length * quantity,
    };
    const actors = [],
      sharedAttempt = {
        attemptId: randomUUID(),
        recoverySecret: randomBytes(32).toString("hex"),
      };
    for (let i = 0; i < 1000; i++) {
      const browserId = randomUUID(),
        identity = settings.scenario === "replayed-attempt" ? 0 : i;
      const address = {
        line1:
          String(10000 + (settings.scenario === "duplicate-address" ? 0 : identity)) +
          " FIXTURE ST",
        line2: null,
        city: "COLUMBIA",
        state: "SC",
        postalCode: "29201",
        country: "US",
      };
      const instagramHandle =
          "load_" + (settings.scenario === "duplicate-instagram" ? "shared" : identity),
        productId = prizes[i % prizes.length].productId;
      const eligibility = {
        campaignId: app.campaignId,
        productId,
        browserId,
        instagramHandle,
        address,
        ...app.helpers.deriveEligibilityKeys(
          app.campaignId,
          instagramHandle,
          address,
          app.secret,
        ),
        identityKeyFingerprint: app.helpers.getIdentityKeyFingerprint(app.secret),
        normalizationVersion: 1,
        expiresAt: Date.now() + 600000,
      };
      actors.push({
        ip:
          settings.scenario === "shared-ip"
            ? "198.51.100.25"
            : "198.18." + Math.floor(i / 254) + "." + (1 + (i % 254)),
        cookie:
          "specialty_browser=" +
          app.helpers.signBrowserCookie(
            browserId,
            Date.now(),
            app.adminSecret.toString("base64"),
          ),
        payload: {
          productId,
          instagramHandle,
          address,
          ...(settings.scenario === "replayed-attempt"
            ? sharedAttempt
            : {
                attemptId: randomUUID(),
                recoverySecret: randomBytes(32).toString("hex"),
              }),
          validationToken: app.helpers.issueEligibilityToken(eligibility, app.secret),
        },
      });
    }
    const raw = JSON.stringify(actors);
    manifest.credentialsSha256 = createHash("sha256").update(raw).digest("hex");
    await writeFile(manifest.privateCredentialFile, raw, {
      mode: 0o600,
    });
    const expected = structuredClone(manifest);
    owned.set(manifest, { app, expected });
    return manifest;
  } catch (error) {
    await stopBrowserTestApp();
    throw error;
  }
}
export async function privateLoadState(manifest) {
  const state = owned.get(manifest);
  assert.ok(state, "Unowned run refused.");
  validateManifestIdentity(manifest, state.expected);
  const campaign = (
    await state.app.db.query("select slug from public.specialty_campaigns where id=$1", [
      manifest.campaignId,
    ])
  ).rows[0];
  assert.equal(
    campaign?.slug,
    manifest.campaignSlug,
    "Test-owned campaign marker missing.",
  );
  const ids = (
    await state.app.db.query(
      "select product_id from public.specialty_product_config where campaign_id=$1",
      [manifest.campaignId],
    )
  ).rows.map((r) => r.product_id);
  assert.ok(
    manifest.productIds.every((id) => ids.includes(id)),
    "Prize ownership changed.",
  );
  return {
    ...state,
    actors: validateCredentialArtifact(
      manifest,
      await readFile(manifest.privateCredentialFile, "utf8"),
    ),
  };
}
export async function reconcileLoadRun(manifest) {
  const { app } = await privateLoadState(manifest);
  // Timed-out clients do not cancel server work. Quiesce only owned transports
  // before taking the final snapshot so a late commit cannot escape the report.
  await stopBrowserTestTransports();
  return (
    await app.db.query(
      `select
    (select count(*)::int from public.specialty_claims where product_id=any($1::uuid[])) "winnerCount",
    (select coalesce(sum(stock),0)::int from public.product_variants where product_id=any($1::uuid[])) "remainingStock",
    (select exists(select 1 from public.product_variants where product_id=any($1::uuid[]) and stock<0)) "negativeStock",
    (select count(*)::int from public.order_items where product_id=any($1::uuid[])) "ordinaryPrizeOrderItems",
    (select count(*)::int from ((select address_key from public.specialty_claims where campaign_id=$2 group by address_key having count(*)>1) union all (select instagram_key from public.specialty_claims where campaign_id=$2 group by instagram_key having count(*)>1)) duplicates) "duplicateIdentities"`,
      [manifest.productIds, manifest.campaignId],
    )
  ).rows[0];
}
export async function cleanupSpecialtyLoadRun(manifest) {
  await privateLoadState(manifest);
  await stopBrowserTestApp();
  owned.delete(manifest);
}
