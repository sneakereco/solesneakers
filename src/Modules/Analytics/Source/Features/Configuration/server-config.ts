import "server-only";

import {
  isPostHogCaptureHost,
  isPostHogProjectKey,
  parsePublicAnalyticsSettings,
  type PostHogCaptureHost,
  type PublicAnalyticsConfig,
} from "./public-config";

type PostHogApiHost = "https://us.posthog.com" | "https://eu.posthog.com";

const API_HOST_BY_CAPTURE_HOST: Record<PostHogCaptureHost, PostHogApiHost> = {
  "https://us.i.posthog.com": "https://us.posthog.com",
  "https://eu.i.posthog.com": "https://eu.posthog.com",
};

export type ServerAnalyticsConfig = PublicAnalyticsConfig &
  Readonly<{
    projectId: string;
    apiHost: PostHogApiHost;
    queryApiKey: string;
    identitySecret: string;
  }>;

function isIdentitySecret(
  secret: string | undefined,
  projectKey: string | undefined,
  queryKey: string | undefined,
): secret is string {
  return (
    typeof secret === "string" &&
    Buffer.byteLength(secret.trim(), "utf8") >= 32 &&
    secret.trim() !== projectKey?.trim() &&
    secret.trim() !== queryKey?.trim()
  );
}

export function readAnalyticsIdentitySecret(env: Record<string, string | undefined>) {
  const secret = env.ANALYTICS_IDENTITY_SECRET;
  return isIdentitySecret(
    secret,
    env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY,
    env.POSTHOG_QUERY_API_KEY,
  )
    ? secret
    : null;
}

export function isServerAnalyticsConfig(
  config: ServerAnalyticsConfig | null,
): config is ServerAnalyticsConfig {
  return (
    !!config &&
    (config.environment === "staging" || config.environment === "production") &&
    isPostHogCaptureHost(config.host) &&
    config.apiHost === API_HOST_BY_CAPTURE_HOST[config.host] &&
    isPostHogProjectKey(config.projectKey) &&
    /^[1-9][0-9]*$/.test(config.projectId) &&
    Number.isSafeInteger(Number(config.projectId)) &&
    /^ph[sx]_[a-zA-Z0-9_-]{20,}$/.test(config.queryApiKey) &&
    isIdentitySecret(config.identitySecret, config.projectKey, config.queryApiKey)
  );
}

export function parseServerAnalyticsSettings(
  env: Record<string, string | undefined>,
): ServerAnalyticsConfig | null {
  const publicConfig = parsePublicAnalyticsSettings(env);
  if (!publicConfig) {
    return null;
  }

  const apiHost = API_HOST_BY_CAPTURE_HOST[publicConfig.host];
  if (env.POSTHOG_API_HOST?.trim() !== apiHost) {
    return null;
  }

  const config: ServerAnalyticsConfig = {
    ...publicConfig,
    apiHost,
    projectId: env.POSTHOG_PROJECT_ID?.trim() ?? "",
    queryApiKey: env.POSTHOG_QUERY_API_KEY?.trim() ?? "",
    identitySecret: env.ANALYTICS_IDENTITY_SECRET ?? "",
  };
  return isServerAnalyticsConfig(config) ? config : null;
}

export function readServerAnalyticsConfig(env: Record<string, string | undefined>) {
  return env.NEXT_PUBLIC_POSTHOG_ENABLED === "true"
    ? parseServerAnalyticsSettings(env)
    : null;
}
