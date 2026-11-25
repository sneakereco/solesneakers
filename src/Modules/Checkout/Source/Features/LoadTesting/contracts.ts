import { createHash } from "node:crypto";
import { z } from "zod";

const id = z.string().min(1).max(200);
const origin = z.string().refine((value) => {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/" &&
      (!u.port || u.port === "443")
    );
  } catch {
    return false;
  }
});
const deny = z.array(id).min(1);
export const loadTargetSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("staging-load-test"),
    baseUrl: origin,
    expected: z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        deploymentId: id,
        projectId: id,
      })
      .strict(),
    resources: z
      .object({
        supabase: z.object({ projectRef: id, url: origin }).strict(),
        redis: z.object({ id, url: origin }).strict(),
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
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type LoadTarget = z.infer<typeof loadTargetSchema> & { digest: string };
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Invalid JSON manifest");
  return text;
}
export function loadDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function parseLoadTarget(value: unknown): LoadTarget {
  const { digest: provided, ...target } = loadTargetSchema.parse(value);
  target.baseUrl = new URL(target.baseUrl).origin;
  const denylist = target.productionDenylist;
  if (
    denylist.hosts.some(
      (host) => host.toLowerCase() === new URL(target.baseUrl).hostname.toLowerCase(),
    ) ||
    denylist.projectIds.includes(target.expected.projectId) ||
    denylist.supabaseRefs.includes(target.resources.supabase.projectRef) ||
    denylist.redisIds.includes(target.resources.redis.id)
  )
    throw new Error("Production resource denied");
  if (
    new URL(target.resources.supabase.url).hostname !==
    `${target.resources.supabase.projectRef}.supabase.co`
  )
    throw new Error("Supabase identity mismatch");
  const digest = loadDigest(target);
  if (provided && provided !== digest) throw new Error("Manifest digest mismatch");
  return { ...target, digest };
}
