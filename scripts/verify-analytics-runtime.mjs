import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Use the caller's existing Vercel authentication for protected deployment URLs.
// Keep curl redirects disabled and discard credential-bearing provider errors.
export function vercelAnalyticsTransport(env, execute = promisify(execFile)) {
  if (!env.VERCEL_TOKEN || env.VERCEL_ORG_ID !== "team_yj8Rl9ibCXwtdttRrYPhnLcD")
    throw Error("analytics_runtime_scope_invalid");
  return async (url, options) => {
    try {
      const { stdout } = await execute(
        "vercel",
        [
          "curl",
          url.href,
          "--scope",
          env.VERCEL_ORG_ID,
          "--",
          "--silent",
          "--show-error",
          "--fail",
          "--connect-timeout",
          "10",
          "--max-time",
          "20",
          "--max-redirs",
          "0",
          "--proto",
          "=https",
          "--user-agent",
          options.headers["User-Agent"],
          "--header",
          "Authorization: " + options.headers.Authorization,
          "--write-out",
          "\n%{http_code}",
        ],
        {
          encoding: "utf8",
          timeout: 45000,
          maxBuffer: 64 * 1024,
          env: {
            ...process.env,
            VERCEL_TOKEN: env.VERCEL_TOKEN,
            VERCEL_ORG_ID: env.VERCEL_ORG_ID,
            VERCEL_PROJECT_ID: env.VERCEL_PROJECT_ID,
            VERCEL_TELEMETRY_DISABLED: "1",
          },
        },
      );
      const boundary = stdout.lastIndexOf("\n");
      if (boundary < 0 || !/^\d{3}$/.test(stdout.slice(boundary + 1))) throw Error();
      return new Response(stdout.slice(0, boundary), {
        status: Number(stdout.slice(boundary + 1)),
      });
    } catch {
      throw Error("analytics_runtime_inspection_unavailable");
    }
  };
}

import {
  analyticsConfigurationFingerprint,
  analyticsPublicBuildFingerprint,
} from "../src/Modules/Analytics/Source/Features/Configuration/deployment-identity.ts";

export async function verifyAnalyticsRuntime(environment, env, transport = fetch) {
  const project = {
    staging: "prj_1WYPAufHsDO7qrv5FOhSynqeZski",
    production: "prj_ROOpjgDuPj2405JzeR1yG4iRtFMf",
  }[environment];
  if (!project || env.VERCEL_PROJECT_ID !== project || !env.CRON_SECRET)
    throw Error("analytics_runtime_scope_invalid");
  const url = new URL("/api/cron/analytics?inspect=1", env.DEPLOYMENT_URL);
  const canonical =
    environment === "staging" ? "soles-stg.vercel.app" : "www.solesneakersnc.com";
  if (
    url.protocol !== "https:" ||
    (!url.hostname.endsWith(".vercel.app") && url.hostname !== canonical)
  )
    throw Error("analytics_runtime_origin_invalid");
  const response = await transport(url, {
    method: "GET",
    headers: {
      "User-Agent": "Solesneakers-Readiness/1.0",
      Authorization: "Bearer " + env.CRON_SECRET,
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error("analytics_runtime_inspection_unavailable");
  const data = await response.json();
  const incomplete =
    !env.NEXT_PUBLIC_POSTHOG_ENABLED ||
    [
      "NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT",
      "NEXT_PUBLIC_POSTHOG_PROJECT_KEY",
      "NEXT_PUBLIC_POSTHOG_HOST",
    ].some((key) => !env[key]);
  const enabled =
    env.NEXT_PUBLIC_POSTHOG_ENABLED === "true" &&
    !(environment === "production" && incomplete);
  const publicConfig = enabled
    ? {
        environment: env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT,
        host: env.NEXT_PUBLIC_POSTHOG_HOST?.trim(),
        projectKey: env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY?.trim(),
      }
    : null;
  if (
    data.enabled !== enabled ||
    data.environment !== (enabled ? environment : null) ||
    (enabled && data.configurationSha256 !== analyticsConfigurationFingerprint(env)) ||
    data.publicBuildSha256 !== analyticsPublicBuildFingerprint(publicConfig)
  )
    throw Error("analytics_runtime_configuration_mismatch");
  return {
    environment,
    enabled,
    runtimeVerified: true,
    compiledPublicSettingsVerified: true,
  };
}
if (process.argv[1]?.endsWith("verify-analytics-runtime.mjs")) {
  try {
    console.log(
      JSON.stringify(
        await verifyAnalyticsRuntime(
          process.argv[2],
          process.env,
          vercelAnalyticsTransport(process.env),
        ),
      ),
    );
  } catch {
    console.error("Analytics deployed configuration could not be verified.");
    process.exitCode = 1;
  }
}
