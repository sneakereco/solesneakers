import { createHash, createHmac } from "node:crypto";
import type { LoadTestContext } from "./context";
import { resolveFixtureContext } from "./context";
import type { RunStore } from "./run-store";
import type { LoadTestSettings } from "./settings";
import { loadDigest } from "./contracts";

type Wire = Record<string, unknown>;
type Payment = {
  id: string;
  order_id: string;
  reference_id: string;
  location_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  version_token: string;
  amount_money: { amount: string; currency: string };
  source_type: string;
  card_details: { card: { card_brand: string; last_4: string } };
};
type OrderState = {
  runId: string;
  slot: number;
  inputDigest: string;
  order: Wire;
  payments: Record<string, { digest: string; payment: Payment }>;
};
type QueuedEvent = { eventId: string; rawBody: string; orderId: string };
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function response(value: unknown, status = 200) {
  return new Response(
    JSON.stringify(value, (key, item) =>
      key === "amount" && typeof item === "string" && /^\d+$/.test(item)
        ? money(item)
        : item,
    ),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
function failure(message: string, status = 400, code = "BAD_REQUEST") {
  return response(
    { errors: [{ category: "INVALID_REQUEST_ERROR", code, detail: message }] },
    status,
  );
}
function money(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("Invalid simulated money");
  return result;
}
function calculate(order: Wire): Wire {
  const items = order.line_items as {
    quantity: string;
    base_price_money: { amount: string };
  }[];
  if (!Array.isArray(items) || !items.length)
    throw new Error("Missing simulated order items");
  const subtotal = items.reduce(
    (sum, item) => sum + money(item.quantity) * money(item.base_price_money.amount),
    0,
  );
  const shipping = (
    (order.service_charges ?? []) as { amount_money: { amount: string } }[]
  ).reduce((sum, charge) => sum + money(charge.amount_money.amount), 0);
  if (!Number.isSafeInteger(subtotal + shipping) || subtotal <= 0)
    throw new Error("Invalid simulated total");
  return {
    ...order,
    total_money: { amount: String(subtotal + shipping), currency: "USD" },
    total_tax_money: { amount: "0", currency: "USD" },
    total_service_charge_money: { amount: String(shipping), currency: "USD" },
  };
}
function paymentEvent(payment: Payment): QueuedEvent {
  const eventId = `load-event:${payment.id}:completed`;
  return {
    eventId,
    orderId: payment.order_id,
    rawBody: JSON.stringify({
      merchant_id: "load-simulation",
      type: "payment.updated",
      event_id: eventId,
      created_at: payment.created_at,
      data: {
        type: "payment",
        id: payment.id,
        object: {
          payment: {
            ...payment,
            amount_money: {
              ...payment.amount_money,
              amount: Number(payment.amount_money.amount),
            },
          },
        },
      },
    }),
  };
}
export function createLoadTestSquareFetch(
  initial: LoadTestContext | null,
  store: RunStore,
  settings: LoadTestSettings,
  locationId: string,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init),
      url = new URL(request.url),
      path = url.pathname;
    if (url.hostname !== "connect.squareupsandbox.com")
      throw new Error("Unexpected simulation provider host");
    const body = request.method === "GET" ? {} : ((await request.json()) as Wire);
    let context = initial;
    if (!context && request.method === "GET") {
      const id = decodeURIComponent(path.split("/").at(-1) ?? "");
      const kind = path.startsWith("/v2/payments/") ? "payment" : "square-order";
      context = await resolveFixtureContext(kind, id, settings, store);
    }
    if (
      !context ||
      context.providerMode !== "simulated" ||
      context.targetDigest !== settings.target.digest
    )
      return failure("No registered load-test context", 403);
    const fault = await store.get<{ kind?: string; latencyMs?: number }>(
      "fault",
      context.runId,
    );
    if (fault?.latencyMs) {
      if (fault.latencyMs < 0 || fault.latencyMs > 10000)
        throw new Error("Invalid fault latency");
      await new Promise((resolve) => setTimeout(resolve, fault.latencyMs));
    }
    if (fault?.kind === "square-timeout") throw new Error("Simulated Square timeout");
    if (path === "/v2/orders/calculate" && request.method === "POST")
      return response({ order: calculate(body.order as Wire) });
    if (path === "/v2/orders" && request.method === "POST") {
      const order = body.order as Wire,
        localId = String(order.reference_id ?? "");
      const owner = await store.get<{ runId: string; slot: number }>(
        "fixture",
        `order:${localId}`,
      );
      if (!owner || owner.runId !== context.runId || owner.slot !== context.slot)
        return failure("Unregistered reservation", 403);
      const id = `lt-order-${localId}`,
        digest = loadDigest(body),
        candidate: OrderState = {
          runId: context.runId,
          slot: context.slot,
          inputDigest: digest,
          order: {
            ...calculate(order),
            id,
            version: 1,
            state: "OPEN",
            location_id: locationId,
          },
          payments: {},
        };
      const state = await store.mutate("square", id, candidate, (old) => {
        if (old.inputDigest !== digest) throw new Error("Order idempotency conflict");
        return old;
      });
      await store.put("fixture", `square-order:${id}`, {
        runId: context.runId,
        slot: context.slot,
      });
      return response({ order: state.order });
    }
    if (path.startsWith("/v2/orders/") && path !== "/v2/orders/calculate") {
      const id = decodeURIComponent(path.slice("/v2/orders/".length)),
        old = await store.get<OrderState>("square", id);
      if (!old || old.runId !== context.runId)
        return failure("Unknown simulated order", 404, "NOT_FOUND");
      if (request.method === "GET") return response({ order: old.order });
      if (request.method === "PUT") {
        const patch = body.order as Wire;
        const state = await store.mutate("square", id, old, (current) => {
          if (
            Number(patch.version) !== Number(current.order.version) ||
            Object.keys(current.payments).length
          )
            throw new Error("Order cannot be canceled");
          return {
            ...current,
            order: {
              ...current.order,
              ...patch,
              version: Number(current.order.version) + 1,
            },
          };
        });
        return response({ order: state.order });
      }
    }
    if (path === "/v2/payments" && request.method === "POST") {
      if (fault?.kind === "decline")
        return response(
          {
            errors: [
              {
                category: "PAYMENT_METHOD_ERROR",
                code: "CARD_DECLINED",
                detail: "Synthetic decline",
              },
            ],
          },
          400,
        );
      const orderId = String(body.order_id ?? ""),
        old = await store.get<OrderState>("square", orderId);
      if (
        !old ||
        old.runId !== context.runId ||
        old.slot !== context.slot ||
        old.order.reference_id !== body.reference_id
      )
        return failure("Payment reservation mismatch", 403);
      const amount = money((body.amount_money as { amount: unknown })?.amount);
      if (
        amount !== money((old.order.total_money as { amount: unknown }).amount) ||
        old.order.state !== "OPEN"
      )
        return failure("Payment total/state mismatch", 409);
      const key = hash(String(body.idempotency_key)),
        digest = loadDigest(body),
        paymentId = `lt-payment-${hash(`${orderId}:${key}`).slice(0, 40)}`,
        at = new Date().toISOString();
      const state = await store.mutate(
        "square",
        orderId,
        old,
        (current) => {
          const existing = current.payments[key];
          if (existing) {
            if (existing.digest !== digest)
              throw new Error("Payment idempotency conflict");
            return current;
          }
          if (Object.keys(current.payments).length)
            throw new Error("A capture already exists");
          const payment: Payment = {
            id: paymentId,
            order_id: orderId,
            reference_id: String(body.reference_id),
            location_id: locationId,
            status: "COMPLETED",
            created_at: at,
            updated_at: at,
            version_token: "1",
            amount_money: { amount: String(amount), currency: "USD" },
            source_type: "CARD",
            card_details: { card: { card_brand: "VISA", last_4: "4242" } },
          };
          return {
            ...current,
            payments: { [key]: { digest, payment } },
            order: {
              ...current.order,
              tenders: [{ payment_id: payment.id }],
              version: Number(current.order.version) + 1,
            },
          };
        },
        {
          kind: "events",
          id: context.runId,
          value: (next) => paymentEvent(next.payments[key].payment),
        },
      );
      await store.put("payment-index", paymentId, { orderId, key });
      await store.put("fixture", `payment:${paymentId}`, {
        runId: context.runId,
        slot: context.slot,
      });
      if (fault?.kind === "timeout-after-capture" || fault?.kind === "response-loss")
        throw new Error("Simulated response loss after capture");
      return response({ payment: state.payments[key].payment });
    }
    if (path.startsWith("/v2/payments/") && request.method === "GET") {
      const id = decodeURIComponent(path.slice("/v2/payments/".length)),
        index = await store.get<{ orderId: string; key: string }>("payment-index", id),
        state = index ? await store.get<OrderState>("square", index.orderId) : null;
      if (!state || state.runId !== context.runId || !index)
        return failure("Unknown simulated payment", 404, "NOT_FOUND");
      return response({ payment: state.payments[index.key].payment });
    }
    return failure("Unsupported simulation endpoint", 400);
  };
}
export async function dispatchDueEvents(
  context: Pick<LoadTestContext, "runId">,
  store: RunStore,
  settings: LoadTestSettings,
  config: { notificationUrl: string; signatureKey: string },
  fetcher: typeof fetch = fetch,
): Promise<{ delivered: number; failed: number }> {
  const expected = `${settings.target.baseUrl}/api/webhooks/square`;
  if (config.notificationUrl !== expected)
    throw new Error("Simulation webhook target mismatch");
  let delivered = 0,
    failed = 0;
  const events = await store.queueItems<QueuedEvent>("events", context.runId, 100);
  for (const event of events) {
    try {
      const signature = createHmac("sha256", config.signatureKey)
        .update(expected + event.rawBody)
        .digest("base64");
      const result = await fetcher(expected, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-square-hmacsha256-signature": signature,
        },
        body: event.rawBody,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) {
        failed++;
        continue;
      }
      await store.acknowledge("events", context.runId, event);
      delivered++;
    } catch {
      failed++;
    }
  }
  return { delivered, failed };
}
