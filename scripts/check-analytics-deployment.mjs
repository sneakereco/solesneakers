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
  const operatorOnly = [
    "POSTHOG_OPERATOR_API_KEY",
    "POSTHOG_PROVISIONING_KEY",
    "DOPPLER_ANALYTICS_TOKEN",
  ];
  if (operatorOnly.some((key) => env[key] || Object.hasOwn(deployed, key))) throw Error();
  const publicSettings = [
    "NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT",
    "NEXT_PUBLIC_POSTHOG_PROJECT_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
  ];
  const declaredFlag = env.NEXT_PUBLIC_POSTHOG_ENABLED;
  if (declaredFlag && !["true", "false"].includes(declaredFlag)) throw Error();
  // production.yml explicitly builds with capture off if any public setting is missing.
  const incomplete = !declaredFlag || publicSettings.some((key) => !env[key]);
  const buildFlag = environment === "production" && incomplete ? "false" : declaredFlag;
  // An absent runtime flag disables server capture.
  const runtimeFlag = deployed.NEXT_PUBLIC_POSTHOG_ENABLED ?? "false";
  if (!["true", "false"].includes(buildFlag) || buildFlag !== runtimeFlag) throw Error();
  if (buildFlag === "false") return;
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
  // Server delivery also reads the capture settings from the Vercel runtime.
  for (const key of [
    ...publicSettings,
    "POSTHOG_API_HOST",
    "POSTHOG_PROJECT_ID",
    "POSTHOG_QUERY_API_KEY",
    "ANALYTICS_IDENTITY_SECRET",
  ]) {
    const protectedValue =
      !key.startsWith("NEXT_PUBLIC_") && deployed[key] === "[SENSITIVE]";
    if (!env[key] || (!protectedValue && deployed[key] !== env[key])) throw Error();
  }
  // Sensitive values cannot be downloaded. Both release workflows verify the
  // running private configuration and compiled public settings after deploy.
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
