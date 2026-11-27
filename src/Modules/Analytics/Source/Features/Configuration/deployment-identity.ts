import { createHash } from "node:crypto";

const keys = [
  "NEXT_PUBLIC_POSTHOG_ENABLED",
  "NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT",
  "NEXT_PUBLIC_POSTHOG_PROJECT_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "POSTHOG_API_HOST",
  "POSTHOG_PROJECT_ID",
  "POSTHOG_QUERY_API_KEY",
  "ANALYTICS_IDENTITY_SECRET",
] as const;

export function analyticsConfigurationFingerprint(
  env: Record<string, string | undefined>,
) {
  return createHash("sha256")
    .update(JSON.stringify(keys.map((key) => [key, env[key] ?? null])))
    .digest("hex");
}

export function analyticsPublicBuildFingerprint(
  config: { environment: string; host: string; projectKey: string } | null,
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        config ? [true, config.environment, config.host, config.projectKey] : [false],
      ),
    )
    .digest("hex");
}
