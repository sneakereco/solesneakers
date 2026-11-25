import manifest from "../../../../../../tests/load/config/staging.example.json";
import { createHash, createHmac } from "node:crypto";
import { readLoadTestSettings } from "../../../Source/Features/LoadTesting/settings";
import type { RunStore, RunRecord } from "../../../Source/Features/LoadTesting/run-store";

export class MemoryRunStore implements RunStore {
  private values = new Map<string, unknown>();
  get<T>(kind: string, id: string): Promise<T | null> {
    return Promise.resolve((this.values.get(`${kind}:${id}`) as T) ?? null);
  }
  put(kind: string, id: string, value: unknown): Promise<void> {
    this.values.set(`${kind}:${id}`, structuredClone(value));
    return Promise.resolve();
  }
  remove(kind: string, id: string): Promise<void> {
    this.values.delete(`${kind}:${id}`);
    return Promise.resolve();
  }
  once(id: string): Promise<boolean> {
    if (this.values.has(`nonce:${id}`)) return Promise.resolve(false);
    this.values.set(`nonce:${id}`, true);
    return Promise.resolve(true);
  }
  async mutate<T>(
    kind: string,
    id: string,
    initial: T,
    change: (value: T) => T,
  ): Promise<T> {
    const next = change((await this.get<T>(kind, id)) ?? initial);
    await this.put(kind, id, next);
    return next;
  }
}
export function fixtureSettings() {
  const env = {
    LOAD_TEST_ENABLED: "true",
    LOAD_TEST_ALLOWED_PROJECT_ID: manifest.expected.projectId,
    LOAD_TEST_SIGNING_KEY: "test-only-signing-key-32-characters-long",
    LOAD_TEST_RESOURCE_MANIFEST: JSON.stringify(manifest),
    VERCEL_PROJECT_ID: manifest.expected.projectId,
    VERCEL_DEPLOYMENT_ID: manifest.expected.deploymentId,
    VERCEL_GIT_COMMIT_SHA: manifest.expected.commit,
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: manifest.resources.supabase.url,
    UPSTASH_REDIS_REST_URL: manifest.resources.redis.url,
    UPSTASH_REDIS_REST_TOKEN: "unit-boundary-only",
  };
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, sorted(item)]),
          )
        : value;
  const configured = {
    ...env,
    LOAD_TEST_RESOURCE_MANIFEST_SHA256: createHash("sha256")
      .update(JSON.stringify(sorted(manifest)))
      .digest("hex"),
  };
  return { env: configured, settings: readLoadTestSettings(configured)! };
}
export function fixtureRun(targetDigest: string): RunRecord {
  return {
    runId: "11111111-1111-4111-8111-111111111111",
    phaseId: "peak-1",
    targetDigest,
    profile: "peak",
    providerMode: "simulated",
    start: 0,
    end: 10000,
    expiresAt: Date.now() + 60000,
    revoked: false,
  };
}
export function signControlRequest(
  settings: ReturnType<typeof fixtureSettings>["settings"],
  operation: string,
  body: Record<string, unknown>,
): Request {
  const text = JSON.stringify(body),
    issued = String(Date.now()),
    nonce = String(body.nonce),
    path = `/api/internal/load-test/${operation}`,
    digest = createHash("sha256").update(text).digest("hex"),
    signature = createHmac("sha256", settings.signingKey)
      .update(["POST", path, nonce, issued, digest].join("\n"))
      .digest("hex");
  return new Request(`${settings.target.baseUrl}${path}`, {
    method: "POST",
    body: text,
    headers: {
      "x-load-test-nonce": nonce,
      "x-load-test-issued-at": issued,
      "x-load-test-body-sha256": digest,
      "x-load-test-control": signature,
    },
  });
}
