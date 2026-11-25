export type PostHogCaptureHost = "https://us.i.posthog.com" | "https://eu.i.posthog.com";

export type PublicAnalyticsConfig = Readonly<{
  projectKey: string;
  host: PostHogCaptureHost;
  environment: "staging" | "production";
}>;

export function isPostHogCaptureHost(
  host: string | undefined,
): host is PostHogCaptureHost {
  return host === "https://us.i.posthog.com" || host === "https://eu.i.posthog.com";
}

export function isPostHogProjectKey(key: string): boolean {
  return /^phc_[a-z0-9]{20,}$/i.test(key);
}

export function readPublicAnalyticsConfig(
  env: Record<string, string | undefined>,
): PublicAnalyticsConfig | null {
  const environment = env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT;
  const projectKey = env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY?.trim() ?? "";
  const host = env.NEXT_PUBLIC_POSTHOG_HOST?.trim();

  if (
    env.NEXT_PUBLIC_POSTHOG_ENABLED !== "true" ||
    (environment !== "staging" && environment !== "production") ||
    !isPostHogCaptureHost(host) ||
    !isPostHogProjectKey(projectKey)
  ) {
    return null;
  }

  return { projectKey, host, environment };
}
