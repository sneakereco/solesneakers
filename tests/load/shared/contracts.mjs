import { createHash } from "node:crypto";
import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const httpsOrigin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (!url.port || url.port === "443")
    );
  } catch {
    return false;
  }
}, "Expected an HTTPS origin without credentials, path, query or fragment");
const deny = z.array(id).min(1);
export const targetSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("staging-load-test"),
    baseUrl: httpsOrigin,
    expected: z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        deploymentId: id,
        projectId: id,
      })
      .strict(),
    resources: z
      .object({
        supabase: z.object({ projectRef: id, url: httpsOrigin }).strict(),
        redis: z.object({ id, url: httpsOrigin }).strict(),
      })
      .strict(),
    productionDenylist: z
      .object({ hosts: deny, projectIds: deny, supabaseRefs: deny, redisIds: deny })
      .strict(),
    migrationHeads: z.array(z.string().regex(/^\d{14}$/)).min(1),
    providerMode: z.enum(["simulated", "sandbox"]),
    requiredCapabilities: z.array(id).min(1),
    telemetry: z.array(id).min(1),
    region: id,
    budget: z
      .object({
        maxCostUsd: z.number().finite().nonnegative(),
        maxRequests: z.number().int().positive(),
        maxDurationSeconds: z.number().int().positive().max(86400),
        maxSessions: z.number().int().positive().max(12000),
      })
      .strict(),
    digest: hash.optional(),
  })
  .strict();

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  if (
    value === undefined ||
    typeof value === "bigint" ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw new Error("Non-JSON manifest value");
  return JSON.stringify(value);
}
export function manifestDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function parseTarget(value) {
  const parsed = targetSchema.parse(value);
  const { digest: supplied, ...target } = parsed;
  target.baseUrl = new URL(target.baseUrl).origin;
  const denied = target.productionDenylist;
  if (
    denied.hosts.some(
      (host) => host.toLowerCase() === new URL(target.baseUrl).hostname.toLowerCase(),
    ) ||
    denied.projectIds.includes(target.expected.projectId) ||
    denied.supabaseRefs.includes(target.resources.supabase.projectRef) ||
    denied.redisIds.includes(target.resources.redis.id)
  )
    throw new Error("Target conflicts with production denylist");
  if (
    new URL(target.resources.supabase.url).hostname !==
    `${target.resources.supabase.projectRef}.supabase.co`
  )
    throw new Error("Supabase URL and project identity differ");
  const digest = manifestDigest(target);
  if (supplied && supplied !== digest) throw new Error("Target manifest digest changed");
  return { ...target, digest };
}
export function assertAttestation(
  target,
  value,
  requiredCapabilities = target.requiredCapabilities,
) {
  if (
    !value ||
    value.baseUrl !== target.baseUrl ||
    value.commit !== target.expected.commit ||
    value.deploymentId !== target.expected.deploymentId ||
    value.projectId !== target.expected.projectId ||
    value.resourceDigest !== manifestDigest(target.resources) ||
    value.providerMode !== target.providerMode ||
    canonicalJson(value.schema) !== canonicalJson(target.migrationHeads)
  )
    throw new Error("Deployment/resource/schema attestation mismatch");
  if (
    !Array.isArray(value.capabilities) ||
    requiredCapabilities.some((capability) => !value.capabilities.includes(capability))
  )
    throw new Error("Required deployed capability unavailable");
  return value;
}
const workerSchema = z
  .object({
    version: z.literal(1),
    runId: id,
    workerId: id,
    profile: id,
    activeSamples: z
      .array(
        z
          .object({
            at: z.number().finite().nonnegative(),
            slots: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
    offered: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    interrupted: z.number().int().nonnegative(),
    operations: z.array(z.record(z.string(), z.unknown())),
    resources: z.array(z.record(z.string(), z.unknown())),
    errors: z.array(z.string()),
  })
  .strict();
export function validateResults(value) {
  const result = workerSchema.parse(value);
  if (result.completed > result.offered)
    throw new Error("Completed work exceeds offered work");
  return result;
}
