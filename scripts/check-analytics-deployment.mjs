import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";

const operatorOnly = [
  "POSTHOG_OPERATOR_API_KEY",
  "POSTHOG_PROVISIONING_KEY",
  "DOPPLER_ANALYTICS_TOKEN",
];
const privateSettings = [
  "POSTHOG_API_HOST",
  "POSTHOG_PROJECT_ID",
  "POSTHOG_QUERY_API_KEY",
  "ANALYTICS_IDENTITY_SECRET",
];
const projects = {
  staging: "prj_1WYPAufHsDO7qrv5FOhSynqeZski",
  production: "prj_ROOpjgDuPj2405JzeR1yG4iRtFMf",
};
const teamId = "team_yj8Rl9ibCXwtdttRrYPhnLcD";
const dopplerConfigurationId = "icfg_lbw5Z4UVhVWQkQsAyvJzSgYY";

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
  for (const key of [...publicSettings, ...privateSettings]) {
    const protectedValue =
      !key.startsWith("NEXT_PUBLIC_") && deployed[key] === "[SENSITIVE]";
    if (!env[key] || (!protectedValue && deployed[key] !== env[key])) throw Error();
  }
  // Both release workflows verify protected runtime and compiled public settings.
}

function productionSecret(row) {
  return (
    typeof row?.id === "string" &&
    /^[\w-]+$/.test(row.id) &&
    row.type === "sensitive" &&
    (row.visibility === undefined || row.visibility === "secret") &&
    Array.isArray(row.target) &&
    row.target.length === 1 &&
    row.target[0] === "production" &&
    !row.gitBranch &&
    (row.customEnvironmentIds == null ||
      (Array.isArray(row.customEnvironmentIds) &&
        row.customEnvironmentIds.length === 0)) &&
    !row.sharedEnvVarId &&
    !row.sharedEnvVariableId &&
    !row.system &&
    !row.contentHint &&
    (row.configurationId == null || row.configurationId === dopplerConfigurationId)
  );
}

export async function checkAndSyncDeployment(
  environment,
  env,
  deployed,
  { project, fetch: send = globalThis.fetch } = {},
) {
  const missing = privateSettings.filter((key) => !Object.hasOwn(deployed, key));
  if (deployed.NEXT_PUBLIC_POSTHOG_ENABLED !== "true" || missing.length === 0) {
    checkDeployment(environment, env, deployed);
    return;
  }

  // Validate the planned configuration before contacting the write-only store.
  checkDeployment(environment, env, {
    ...deployed,
    ...Object.fromEntries(missing.map((key) => [key, env[key]])),
  });
  const linked = project ?? JSON.parse(readFileSync(".vercel/project.json", "utf8"));
  if (
    !env.VERCEL_TOKEN ||
    linked.projectId !== projects[environment] ||
    linked.projectId !== env.VERCEL_PROJECT_ID ||
    linked.orgId !== teamId ||
    linked.orgId !== env.VERCEL_ORG_ID
  )
    throw Error();

  const request = async (path, method, body) => {
    const url = new URL(path, "https://api.vercel.com");
    url.searchParams.set("teamId", teamId);
    if (method === "GET") url.searchParams.set("decrypt", "false");
    try {
      const response = await send(url, {
        method,
        headers: {
          Authorization: "Bearer " + env.VERCEL_TOKEN,
          "Content-Type": "application/json",
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 200) return await response.json();
    } catch {
      // Request and provider response details may contain sensitive values.
    }
    throw Error();
  };
  const projectPath = "/projects/" + linked.projectId + "/env";
  const { envs } = await request("/v10" + projectPath, "GET");
  if (!Array.isArray(envs) || envs.some((row) => typeof row?.key !== "string"))
    throw Error();
  const runtime = envs.filter(
    (row) => !Array.isArray(row.target) || row.target.includes("production"),
  );
  if (runtime.some(({ key }) => operatorOnly.includes(key))) throw Error();
  const records = missing.map((key) => {
    const matches = runtime.filter((row) => row.key === key);
    if (matches.length !== 1 || !productionSecret(matches[0])) throw Error();
    return matches[0];
  });
  if (new Set(records.map((row) => row.id)).size !== records.length) throw Error();

  // A successful write confirms the value configured for the next deployment.
  for (const record of records) {
    const receipt = await request(
      "/v9" + projectPath + "/" + record.id,
      "PATCH",
      JSON.stringify({ value: env[record.key] }),
    );
    if (
      !productionSecret(receipt) ||
      receipt.key !== record.key ||
      receipt.id !== record.id ||
      (receipt.configurationId ?? null) !== (record.configurationId ?? null)
    )
      throw Error();
  }
}

if (import.meta.main) {
  try {
    await checkAndSyncDeployment(
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
