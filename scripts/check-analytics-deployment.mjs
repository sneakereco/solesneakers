import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";

export function pairingFingerprint(config) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        config.environment,
        config.apiHost,
        config.projectId,
        config.host,
        config.projectKey,
      ]),
    )
    .digest("hex");
}
export function checkDeployment(environment, env, deployed) {
  if (!["staging", "production"].includes(environment)) throw Error();
  const operatorOnly = ["POSTHOG_OPERATOR_API_KEY", "POSTHOG_PROVISIONING_KEY"];
  if (operatorOnly.some((key) => env[key] || Object.hasOwn(deployed, key))) throw Error();
  if (env.NEXT_PUBLIC_POSTHOG_ENABLED !== "true") return;
  const config = {
    environment: env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT,
    apiHost: env.POSTHOG_API_HOST,
    projectId: env.POSTHOG_PROJECT_ID,
    host: env.NEXT_PUBLIC_POSTHOG_HOST,
    projectKey: env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY,
  };
  if (
    config.environment !== environment ||
    env.ANALYTICS_VERIFIED_PAIRING !== pairingFingerprint(config)
  )
    throw Error();
  // Doppler's Vercel sync supplies private application values. Compare in memory.
  for (const key of [
    "POSTHOG_API_HOST",
    "POSTHOG_PROJECT_ID",
    "POSTHOG_QUERY_API_KEY",
    "ANALYTICS_IDENTITY_SECRET",
  ]) {
    if (!env[key] || deployed[key] !== env[key]) throw Error();
  }
}
if (process.argv[1]?.endsWith("check-analytics-deployment.mjs")) {
  try {
    checkDeployment(
      process.argv[2],
      process.env,
      parseEnv(readFileSync(".vercel/.env.production.local", "utf8")),
    );
    console.log("Analytics deployment configuration checked.");
  } catch {
    console.error("Analytics deployment configuration is unverified.");
    process.exitCode = 1;
  }
}
