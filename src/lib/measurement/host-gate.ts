import type { MeasurementEnvironment } from "@/lib/measurement/contract";

// Match the configured canonical site; deployment and preview URLs stay inert.
export function isApprovedMeasurementHostname(
  hostname: string,
  environment: MeasurementEnvironment,
): boolean {
  if (environment === "staging") {
    return hostname === "soles-stg.vercel.app";
  }
  return (
    !hostname.endsWith(".vercel.app") &&
    process.env.NEXT_PUBLIC_SITE_URL === `https://${hostname}`
  );
}
