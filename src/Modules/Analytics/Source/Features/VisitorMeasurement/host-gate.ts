import {
  readPublicAnalyticsConfig,
  type PublicAnalyticsConfig,
} from "../Configuration/public-config";
export function configuredMeasurement() {
  return readPublicAnalyticsConfig({
    NEXT_PUBLIC_POSTHOG_ENABLED: process.env.NEXT_PUBLIC_POSTHOG_ENABLED,
    NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: process.env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT,
    NEXT_PUBLIC_POSTHOG_PROJECT_KEY: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}
export function isApprovedMeasurementHostname(
  hostname: string,
  environment: PublicAnalyticsConfig["environment"],
) {
  if (environment === "staging") return hostname === "soles-stg.vercel.app";
  return (
    !hostname.endsWith(".vercel.app") &&
    !/^(?:localhost|[\d.]+|\[.*\])$/.test(hostname) &&
    !hostname.endsWith(".localhost") &&
    !hostname.endsWith(".test") &&
    process.env.NEXT_PUBLIC_SITE_URL === "https://" + hostname
  );
}
