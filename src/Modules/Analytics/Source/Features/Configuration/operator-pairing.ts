import "server-only";
import {
  parseServerAnalyticsSettings,
  type ServerAnalyticsConfig,
} from "./server-config";

export async function pairOwnerProject(
  env: Record<string, string | undefined>,
  environment: "staging" | "production",
  request: typeof fetch = fetch,
) {
  const config = parseServerAnalyticsSettings(env);
  const org = env.POSTHOG_OWNER_ORGANIZATION_ID ?? "";
  const key = env.POSTHOG_OPERATOR_API_KEY ?? "";
  const expected = env[`POSTHOG_OWNER_${environment.toUpperCase()}_PROJECT_ID`];
  const other =
    environment === "staging"
      ? env.POSTHOG_OWNER_PRODUCTION_PROJECT_ID
      : env.POSTHOG_OWNER_STAGING_PROJECT_ID;
  if (
    !config ||
    config.environment !== environment ||
    config.projectId !== expected ||
    other === expected ||
    (environment === "production" && !/^[1-9]\d*$/.test(other ?? "")) ||
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(org) ||
    !/^ph[xs]_[a-z\d_-]{20,}$/i.test(key) ||
    key === config.queryApiKey
  )
    throw new Error("Owner project configuration unavailable");
  const url = `${config.apiHost}/api/organizations/${org}/projects/${expected}/`;
  const response = await request(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Owner project metadata unavailable");
  // Metadata contains other secret fields. Never log or return the response.
  const metadata = await response.json();
  if (
    metadata?.id !== Number(expected) ||
    metadata.organization !== org ||
    metadata.api_token !== config.projectKey ||
    metadata.anonymize_ips !== true
  )
    throw new Error("Owner pairing or project IP setting unverified");
  return config;
}

export async function readNativeRetention(
  config: ServerAnalyticsConfig,
  operatorKey: string,
  request: typeof fetch = fetch,
) {
  if (operatorKey === config.queryApiKey || !/^ph[xs]_[a-z\d_-]{20,}$/i.test(operatorKey))
    throw Error("Operator credential required");
  const response = await request(
    config.apiHost + "/api/projects/" + config.projectId + "/events_retention/",
    {
      method: "GET",
      headers: { Authorization: "Bearer " + operatorKey },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok || !response.body) throw Error("Effective retention unavailable");
  const content = response.body.getReader();
  let bytes = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await content.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 64 * 1024) {
      await content.cancel();
      throw Error("Invalid retention metadata");
    }
    parts.push(value);
  }
  const { retention_months: months, retained_from: retainedFrom } = JSON.parse(
    Buffer.concat(parts).toString("utf8"),
  );
  if (months === null && retainedFrom === null)
    return { months: null, retainedFrom: null };
  if (
    !Number.isSafeInteger(months) ||
    months < 1 ||
    months > 1200 ||
    typeof retainedFrom !== "string" ||
    !/^\d{4}-\d\d-\d\d$/.test(retainedFrom) ||
    new Date(retainedFrom).toISOString().slice(0, 10) !== retainedFrom
  )
    throw Error("Invalid retention metadata");
  return { months: months as number, retainedFrom };
}
