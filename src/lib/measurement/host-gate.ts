import type { MeasurementEnvironment } from "@/lib/measurement/contract";

// Match the canonical site URL baked into this build, never a deployment URL.
export function isApprovedMeasurementHostname(
  hostname: string,
  environment: MeasurementEnvironment,
  siteUrl = process.env.NEXT_PUBLIC_MEASUREMENT_SITE_URL,
): boolean {
  if (environment === "staging") {
    return hostname === "soles-stg.vercel.app";
  }
  if (!siteUrl) {
    return false;
  }
  try {
    const configured = new URL(siteUrl);
    return (
      configured.protocol === "https:" &&
      configured.username === "" &&
      configured.password === "" &&
      configured.port === "" &&
      configured.pathname === "/" &&
      configured.search === "" &&
      configured.hash === "" &&
      configured.hostname !== "vercel.app" &&
      !configured.hostname.endsWith(".vercel.app") &&
      hostname === configured.hostname
    );
  } catch {
    return false;
  }
}
