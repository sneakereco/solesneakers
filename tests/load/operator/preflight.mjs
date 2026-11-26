import { createHash, createHmac, randomUUID } from "node:crypto";
import { parseTarget, assertAttestation } from "../shared/contracts.mjs";
import { profileLimits } from "../shared/profiles.mjs";
export function boundedFetch(input, options = {}) {
  const signals = [
    AbortSignal.timeout(15000),
    ...(options.signal ? [options.signal] : []),
  ];
  return fetch(input, {
    ...options,
    redirect: "error",
    signal: AbortSignal.any(signals),
  });
}
export const REQUIRED_SECRETS = [
  "LOAD_TEST_SIGNING_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_DB_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
export function createControlClient(
  target,
  key,
  fetcher = fetch,
  { minimumIntervalMs = 2500 } = {},
) {
  if (!key || key.length < 32) throw Error("Missing staging signing authorization");
  let nextAt = 0,
    pending = Promise.resolve();
  return async (operation, input = {}) => {
    if (
      ![
        "attest",
        "register",
        "fixtures",
        "revoke",
        "status",
        "events",
        "faults",
        "cleanup",
        "lease",
        "heartbeat",
      ].includes(operation)
    )
      throw Error("Unknown control operation");
    const turn = pending.then(async () => {
      const delay = nextAt - Date.now();
      if (delay > 0) await new Promise((done) => setTimeout(done, delay));
      nextAt = Date.now() + minimumIntervalMs;
    });
    pending = turn.catch(() => {});
    await turn;
    const path = `/api/internal/load-test/${operation}`,
      nonce = randomUUID(),
      issued = String(Date.now()),
      body = JSON.stringify(input),
      digest = createHash("sha256").update(body).digest("hex"),
      signature = createHmac("sha256", key)
        .update(["POST", target.baseUrl, path, nonce, issued, digest].join("\n"))
        .digest("hex");
    const response = await fetcher(target.baseUrl + path, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        Origin: target.baseUrl,
        "x-load-test-control": signature,
        "x-load-test-issued-at": issued,
        "x-load-test-nonce": nonce,
        "x-load-test-body-sha256": digest,
      },
      redirect: "error",
      signal: AbortSignal.timeout(
        ["attest", "heartbeat"].includes(operation) ? 5000 : 30000,
      ),
    });
    if (!response.ok)
      throw Error(`Staging control ${operation} refused (${response.status})`);
    const value = await response.json();
    if (operation === "attest" && value.nonce !== nonce)
      throw Error("Attestation nonce mismatch");
    return value;
  };
}
export async function preflightRun(rawTarget, profile, dependencies = {}) {
  const gates = [],
    coverage = [],
    env = dependencies.env ?? process.env;
  let target, attestation;
  const check = async (name, work) => {
    try {
      const value = await work();
      gates.push({ name, status: "pass", reasons: [] });
      return value;
    } catch (error) {
      gates.push({ name, status: "unmet", reasons: [error.message] });
      return null;
    }
  };
  target = await check("target-isolation", () => parseTarget(rawTarget));
  await check("fixture-request-budget", () => {
    if (profile === "recovery") return;
    const sizing = profileLimits(profile);
    if (!sizing || !target || target.budget.maxRequests < sizing[0] * 200)
      throw Error(
        "Approve a request budget of at least 200 requests per configured actor before this profile; no traffic has started",
      );
  });
  await check("bulk-provider-mode", () => {
    if (profile !== "recovery" && target?.providerMode !== "simulated")
      throw Error(
        "Bulk profiles require simulated providers; real Sandbox checks must be separately bounded",
      );
  });
  await check("staging-authorization", () => {
    const missing = REQUIRED_SECRETS.filter((key) => !env[key]);
    if (missing.length)
      throw Error(
        `Authorize the staging Doppler configuration or environment with: ${missing.join(", ")}`,
      );
    if (env.LOAD_TEST_SIGNING_KEY.length < 32)
      throw Error("Staging signing key must have at least 32 characters");
  });
  if (gates.some((x) => x.status !== "pass")) return { allowed: false, gates, coverage };
  const control =
    dependencies.control ?? createControlClient(target, env.LOAD_TEST_SIGNING_KEY);
  attestation = await check("immutable-attestation", async () =>
    assertAttestation(
      target,
      await control("attest", {}),
      profile === "claim-rush" ? ["shopping", "specialty-claims"] : ["shopping"],
    ),
  );
  if (attestation)
    for (const capability of target.requiredCapabilities)
      if (!attestation.capabilities.includes(capability))
        coverage.push({
          name: capability,
          status: "unmet",
          reasons: [
            "Required deployed capability is absent; ordinary shopping diagnostics remain available",
          ],
        });
  await check("locked-toolchain", async () => {
    const result = await dependencies.tooling?.();
    if (!result || result.status !== "pass")
      throw Error(result?.reason ?? "Run the locked local runner bootstrap");
  });
  await check("resource-identity", async () => {
    const result = await dependencies.resources?.(target);
    if (!result || result.status !== "pass")
      throw Error(
        result?.reason ?? "Staging database/Redis access has not been verified",
      );
  });
  return {
    allowed: gates.every((x) => x.status === "pass"),
    gates,
    coverage,
    attestation,
  };
}
