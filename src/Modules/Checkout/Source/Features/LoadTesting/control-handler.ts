import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { loadDigest } from "./contracts";
import { issuePhaseCredential } from "./context";
import { createLoadRunStore, type RunRecord, type RunStore } from "./run-store";
import { readLoadTestSettings, type LoadTestSettings } from "./settings";
import { dispatchDueEvents } from "./square-adapter";
import { getSquareConfig } from "@/lib/square/config";

const operations = [
  "attest",
  "register",
  "fixtures",
  "revoke",
  "status",
  "events",
  "faults",
];
const registration = z
  .object({
    runId: z.string().uuid(),
    phaseId: z.string().regex(/^[\w-]{1,100}$/),
    profile: z.string().min(1).max(100),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive().max(12000),
    expiresAt: z.number().int().positive(),
  })
  .strict();
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function verifyControlHeaders(
  request: Request,
  settings: LoadTestSettings,
): boolean {
  const url = new URL(request.url),
    nonce = request.headers.get("x-load-test-nonce"),
    issued = request.headers.get("x-load-test-issued-at"),
    digest = request.headers.get("x-load-test-body-sha256"),
    signature = request.headers.get("x-load-test-control");
  if (
    request.method !== "POST" ||
    url.origin !== settings.target.baseUrl ||
    !/^\/api\/internal\/load-test\/(?:attest|register|fixtures|revoke|status|events|faults)$/.test(
      url.pathname,
    ) ||
    !nonce ||
    !/^[\w-]{1,100}$/.test(nonce) ||
    !issued ||
    !Number.isFinite(Number(issued)) ||
    Math.abs(Date.now() - Number(issued)) > 30000 ||
    !digest ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !signature
  )
    return false;
  const expected = createHmac("sha256", settings.signingKey)
    .update([request.method, url.pathname, nonce, issued, digest].join("\n"))
    .digest("hex");
  const a = Buffer.from(expected),
    b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
type Dependencies = { settings: LoadTestSettings | null; store: RunStore };
export async function handleLoadTestControl(
  request: Request,
  operation: string,
  dependencies?: Dependencies,
): Promise<Response> {
  try {
    const settings = dependencies ? dependencies.settings : readLoadTestSettings();
    if (!settings || !operations.includes(operation))
      return json({ error: "Not found" }, 404);
    if (
      !verifyControlHeaders(request, settings) ||
      !new URL(request.url).pathname.endsWith(`/${operation}`)
    )
      return json({ error: "Forbidden" }, 403);
    const text = await request.clone().text();
    if (Buffer.byteLength(text) > 65536) return json({ error: "Body too large" }, 413);
    if (
      createHash("sha256").update(text).digest("hex") !==
      request.headers.get("x-load-test-body-sha256")
    )
      return json({ error: "Body signature mismatch" }, 403);
    const store = dependencies?.store ?? createLoadRunStore(settings);
    if (!(await store.once(request.headers.get("x-load-test-nonce")!)))
      return json({ error: "Replayed control request" }, 403);
    const { nonce: _nonce, ...body } = JSON.parse(text) as Record<string, unknown>;
    if (operation === "attest")
      return json({
        ...settings.target.expected,
        baseUrl: settings.target.baseUrl,
        resourceDigest: loadDigest(settings.target.resources),
        schema: settings.target.migrationHeads,
        providerMode: settings.target.providerMode,
        capabilities: ["shopping"],
        nonce: request.headers.get("x-load-test-nonce"),
      });
    if (operation === "register") {
      const input = registration.parse(body);
      if (
        input.end <= input.start ||
        input.end > settings.target.budget.maxSessions ||
        input.expiresAt <= Date.now() ||
        input.expiresAt > Date.now() + 4 * 3600000
      )
        return json({ error: "Invalid phase bounds" }, 400);
      await store.mutate<{ runId: string; expiresAt: number }>(
        "lock",
        "target",
        { runId: input.runId, expiresAt: 0 },
        (old) => {
          if (old.expiresAt > Date.now() && old.runId !== input.runId)
            throw new Error("Another run owns this deployment");
          return { runId: input.runId, expiresAt: input.expiresAt };
        },
      );
      const run: RunRecord = {
        ...input,
        targetDigest: settings.target.digest,
        providerMode: settings.target.providerMode,
        revoked: false,
      };
      await store.put("run", run.runId, run);
      return json({
        credential: issuePhaseCredential(run, settings),
        expiresAt: run.expiresAt,
      });
    }
    const runId = z.string().uuid().parse(body.runId);
    const run = await store.get<RunRecord>("run", runId);
    if (!run || run.targetDigest !== settings.target.digest)
      return json({ error: "Run not found" }, 404);
    if (operation === "revoke") {
      await store.put("run", runId, { ...run, revoked: true });
      return json({ revoked: true });
    }
    if (operation === "fixtures") {
      const fixtures = z
        .array(
          z
            .object({
              kind: z.enum([
                "product",
                "variant",
                "order",
                "square-order",
                "payment",
                "email",
                "account",
                "claim",
                "campaign",
                "address",
              ]),
              id: z.string().regex(/^[\w.@:-]{1,200}$/),
              slot: z.number().int().nonnegative(),
            })
            .strict(),
        )
        .min(1)
        .max(100)
        .parse(body.fixtures);
      if (
        run.revoked ||
        run.expiresAt <= Date.now() ||
        fixtures.some((f) => f.slot < run.start || f.slot >= run.end)
      )
        return json({ error: "Fixture scope invalid" }, 403);
      for (const fixture of fixtures) {
        const key = `${fixture.kind}:${fixture.id}`;
        const previous = await store.get<{ runId: string }>("fixture", key);
        if (previous && previous.runId !== runId)
          return json({ error: "Fixture already owned" }, 409);
        await store.put("fixture", key, { runId, slot: fixture.slot });
      }
      return json({ registered: fixtures.length });
    }
    if (operation === "events") {
      const config = getSquareConfig();
      return json(
        await dispatchDueEvents({ runId }, store, settings, {
          notificationUrl: config.webhookNotificationUrl,
          signatureKey: config.webhookSignatureKey,
        }),
      );
    }
    if (operation === "faults") {
      const kind = z
        .enum([
          "none",
          "square-timeout",
          "timeout-after-capture",
          "response-loss",
          "decline",
          "shippo-unavailable",
          "smtp-outage",
        ])
        .parse(body.kind);
      if (kind === "none") await store.remove("fault", runId);
      else await store.put("fault", runId, { kind });
      return json({ configured: kind });
    }
    const ids = z
      .array(z.string().regex(/^[\w:-]{1,200}$/))
      .max(100)
      .parse(body.squareOrderIds ?? []);
    const ledgers = await Promise.all(
      ids.map(async (id) => {
        const value = await store.get<{
          runId: string;
          order: { reference_id: string };
          payments: Record<
            string,
            { payment: { id: string; status: string; amount_money: { amount: string } } }
          >;
        }>("square", id);
        if (!value || value.runId !== runId) throw new Error("Unowned ledger");
        return {
          squareOrderId: id,
          localOrderId: value.order.reference_id,
          payments: Object.values(value.payments).map(({ payment }) => ({
            id: payment.id,
            status: payment.status,
            totalCents: Number(payment.amount_money.amount),
          })),
        };
      }),
    );
    return json({ run, ledgers });
  } catch (error) {
    return json(
      {
        error:
          error instanceof z.ZodError
            ? "Invalid control payload"
            : "Load control unavailable",
      },
      error instanceof z.ZodError ? 400 : 503,
    );
  }
}
