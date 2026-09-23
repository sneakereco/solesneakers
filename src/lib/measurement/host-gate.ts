import type { MeasurementEnvironment } from "@/lib/measurement/contract";

// Exact Vercel-assigned storefront domains only. Deployment and preview URLs stay inert.
export function isApprovedMeasurementHostname(
  hostname: string,
  environment: MeasurementEnvironment,
): boolean {
  if (environment === "staging") {
    return hostname === "soles-stg.vercel.app";
  }
  return hostname === "shopsolesneakers.com" || hostname === "soles-pro-rose.vercel.app";
}
