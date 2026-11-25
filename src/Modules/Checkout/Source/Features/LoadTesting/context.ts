import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { LoadTestSettings } from "./settings";
import { readLoadTestSettings } from "./settings";
import { createLoadRunStore, type RunRecord, type RunStore } from "./run-store";

const verified = Symbol("verified-load-context");
export type LoadTestContext = Readonly<
  RunRecord & { slot: number; networkKey: string; [verified]: true }
>;
const active = new AsyncLocalStorage<LoadTestContext>();
const tokenSchema = z
  .object({
    runId: z.string().uuid(),
    phaseId: z.string().min(1),
    targetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().int().positive(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive().max(12000),
  })
  .strict();
function mac(value: string, key: string) {
  return createHmac("sha256", key).update(value).digest("base64url");
}
function same(left: string, right: string) {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function issuePhaseCredential(run: RunRecord, settings: LoadTestSettings): string {
  if (
    run.targetDigest !== settings.target.digest ||
    run.expiresAt <= Date.now() ||
    run.expiresAt > Date.now() + 4 * 3600000
  )
    throw new Error("Invalid phase credential deadline");
  const value = Buffer.from(
    JSON.stringify({
      runId: run.runId,
      phaseId: run.phaseId,
      targetDigest: run.targetDigest,
      expiresAt: run.expiresAt,
      start: run.start,
      end: run.end,
    }),
  ).toString("base64url");
  return `${value}.${mac(value, settings.signingKey)}`;
}
export function isHarnessShopperRoute(path: string): boolean {
  return (
    [
      "/",
      "/store",
      "/cart",
      "/checkout",
      "/checkout/start",
      "/checkout/processing",
      "/checkout/success",
      "/checkout/cancel",
      "/auth/login",
      "/api/auth/session",
      "/api/auth/login",
      "/api/store/products",
      "/api/store/filters",
      "/api/store/taxonomy",
      "/api/featured-items",
      "/api/cart/validate",
      "/api/checkout/quote",
      "/api/checkout/prepare",
      "/api/checkout/payment-permit",
      "/api/checkout/pay",
    ].includes(path) ||
    /^\/(?:store|order-status)\/[a-f0-9-]{36}$/i.test(path) ||
    /^\/api\/(?:store\/products|orders)\/[a-f0-9-]{36}$/i.test(path)
  );
}
function contextFor(run: RunRecord, slot: number): LoadTestContext {
  return Object.freeze({
    ...run,
    slot,
    networkKey: `load:${run.runId}:slot:${slot}`,
    [verified]: true as const,
  });
}
export async function verifyHarnessRequest(
  request: Request,
  settings: LoadTestSettings | null,
  store: RunStore,
): Promise<LoadTestContext | null> {
  const token = request.headers.get("x-load-test-credential");
  if (!settings || !token) return null;
  const url = new URL(request.url);
  if (url.origin !== settings.target.baseUrl || !isHarnessShopperRoute(url.pathname))
    throw new Error("Harness route/host forbidden");
  if (token.length > 3000) throw new Error("Harness credential invalid");
  const [value, signature, ...extra] = token.split(".");
  if (
    !value ||
    !signature ||
    extra.length ||
    !same(mac(value, settings.signingKey), signature)
  )
    throw new Error("Harness signature invalid");
  const claims = tokenSchema.parse(
    JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
  );
  const slot = Number(request.headers.get("x-load-test-slot"));
  if (
    !request.headers.has("x-load-test-slot") ||
    !Number.isSafeInteger(slot) ||
    slot < claims.start ||
    slot >= claims.end ||
    claims.expiresAt <= Date.now() ||
    claims.targetDigest !== settings.target.digest
  )
    throw new Error("Harness scope invalid");
  const run = await store.get<RunRecord>("run", claims.runId);
  if (
    !run ||
    run.revoked ||
    run.expiresAt <= Date.now() ||
    run.phaseId !== claims.phaseId ||
    run.targetDigest !== claims.targetDigest ||
    run.expiresAt !== claims.expiresAt ||
    run.start !== claims.start ||
    run.end !== claims.end
  )
    throw new Error("Harness phase inactive");
  return contextFor(run, slot);
}
export async function resolveFixtureContext(
  kind: string,
  id: string,
  settings: LoadTestSettings | null,
  store: RunStore,
): Promise<LoadTestContext | null> {
  if (!settings) return null;
  const owner = await store.get<{ runId: string; slot: number }>(
    "fixture",
    `${kind}:${id}`,
  );
  if (!owner) return null;
  const run = await store.get<RunRecord>("run", owner.runId);
  if (
    !run ||
    run.targetDigest !== settings.target.digest ||
    run.revoked ||
    run.expiresAt <= Date.now() ||
    owner.slot < run.start ||
    owner.slot >= run.end
  )
    throw new Error("Fixture phase inactive");
  return contextFor(run, owner.slot);
}
export function getActiveLoadTestContext(): LoadTestContext | null {
  return active.getStore() ?? null;
}
export function withLoadTestContext<T>(
  context: LoadTestContext,
  work: () => Promise<T>,
): Promise<T> {
  if (context[verified] !== true) throw new Error("Unverified load context");
  return active.run(context, work);
}
export async function withLoadTestRequest<T>(
  request: Request,
  work: () => Promise<T>,
): Promise<T | Response> {
  try {
    const settings = readLoadTestSettings();
    if (!settings) return work();
    const context = await verifyHarnessRequest(
      request,
      settings,
      createLoadRunStore(settings),
    );
    return context ? withLoadTestContext(context, work) : work();
  } catch {
    return Response.json(
      { error: "Load-test admission failed" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
}
