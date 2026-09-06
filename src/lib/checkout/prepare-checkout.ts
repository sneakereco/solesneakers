import type { NextRequest } from "next/server";

import type { CheckoutAccessDecision } from "@/lib/checkout/checkout-access";
import type {
  CheckoutAttemptDecision,
  CheckoutAttemptIdentity,
} from "@/lib/checkout/checkout-attempt-limit";
import type { ResolvedCheckoutCart } from "@/lib/checkout/checkout-cart-resolver";
import { createCheckoutCartHash } from "@/lib/checkout/checkout-cart-hash";
import type {
  CheckoutPricingQuote,
  CheckoutPricingQuoteInput,
} from "@/lib/checkout/checkout-pricing-gateway";
import { normalizeCheckoutEmail } from "@/lib/checkout/checkout-identity";
import {
  prepareCheckoutRequestSchema,
  type PrepareCheckoutRequest,
} from "@/lib/checkout/checkout-request";
import type { CheckoutBotVerdict } from "@/lib/security/checkout-bot";
import type {
  SquareCheckoutOrder,
  SquareCheckoutOrderInput,
} from "@/lib/square/checkout-orders";
import type {
  CheckoutReservationResult,
  ExistingCheckout,
  ReserveCheckoutInput,
} from "@/repositories/checkout-reservation-repo";

type CheckoutSession = { user: { id: string; email: string } } | null;

export type PrepareCheckoutDependencies = {
  findTenantId(): Promise<string | null>;
  getAccess(tenantId: string): Promise<CheckoutAccessDecision>;
  verifyBrowser(): Promise<CheckoutBotVerdict>;
  getClientIp(request: NextRequest): string | null;
  getSession(): Promise<CheckoutSession>;
  hashEmail(email: string): string;
  findExisting(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<ExistingCheckout | null>;
  checkAttempt(identity: CheckoutAttemptIdentity): Promise<CheckoutAttemptDecision>;
  resolveCart(
    tenantId: string,
    items: PrepareCheckoutRequest["items"],
  ): Promise<ResolvedCheckoutCart>;
  quote(input: CheckoutPricingQuoteInput): Promise<CheckoutPricingQuote>;
  reserve(input: ReserveCheckoutInput): Promise<CheckoutReservationResult>;
  createGuestAccessToken(orderId: string): Promise<string>;
  createSquareOrder(input: SquareCheckoutOrderInput): Promise<SquareCheckoutOrder>;
  attachSquareOrder(orderId: string, order: SquareCheckoutOrder): Promise<void>;
  cancelSquareOrder(
    orderId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<void>;
  releaseReservation(orderId: string, reason: string): Promise<boolean>;
  reportError(error: unknown): void;
  now(): Date;
};

function json(body: Record<string, unknown>, status: number, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function totals(value: {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}) {
  return {
    subtotalCents: value.subtotalCents,
    shippingCents: value.shippingCents,
    taxCents: value.taxCents,
    totalCents: value.totalCents,
  };
}

function isFuture(iso: string, now: Date) {
  const value = new Date(iso).getTime();
  return Number.isFinite(value) && value > now.getTime();
}

function maskIp(ip: string): string {
  if (ip.includes(":")) return `${ip.split(":").slice(0, 4).join(":")}::/64`;
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.0/24` : "unparseable";
}

async function guestToken(
  orderId: string,
  isGuest: boolean,
  deps: PrepareCheckoutDependencies,
) {
  return isGuest ? deps.createGuestAccessToken(orderId) : undefined;
}

export async function prepareCheckoutHandler(
  request: NextRequest,
  deps: PrepareCheckoutDependencies,
): Promise<Response> {
  try {
    const tenantId = await deps.findTenantId();
    if (!tenantId) return json({ error: "Checkout is temporarily unavailable" }, 503);
    const access = await deps.getAccess(tenantId);
    if (!access.open) return json({ error: access.message }, 503);
    const bot = await deps.verifyBrowser();
    if (!bot.allowed)
      return json(
        { error: "Checkout verification failed" },
        bot.reason === "bot" ? 403 : 503,
      );

    const parsed = prepareCheckoutRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return json({ error: "Invalid checkout request" }, 400);
    const clientIp = deps.getClientIp(request);
    if (!clientIp)
      return json({ error: "Checkout protection is temporarily unavailable" }, 503);

    const session = await deps.getSession();
    const accountEmail = session?.user.email
      ? normalizeCheckoutEmail(session.user.email)
      : null;
    if (
      accountEmail &&
      parsed.data.buyerEmail &&
      accountEmail !== parsed.data.buyerEmail
    ) {
      return json({ error: "Checkout email does not match the signed-in account" }, 400);
    }
    const buyerEmail = accountEmail ?? parsed.data.buyerEmail ?? null;
    if (!buyerEmail) return json({ error: "A buyer email is required" }, 400);

    const cartHash = createCheckoutCartHash({
      tenantId,
      buyerEmail,
      fulfillment: parsed.data.fulfillment,
      shippingAddress: parsed.data.shippingAddress,
      items: parsed.data.items,
    });
    const existing = await deps.findExisting(tenantId, parsed.data.idempotencyKey);
    if (existing) {
      if (existing.cartHash !== cartHash)
        return json({ error: "Checkout key conflicts with another cart" }, 409);
      if (existing.status !== "pending" || !isFuture(existing.expiresAt, deps.now())) {
        return json({ error: "Checkout cannot be reused" }, 409);
      }
      if (existing.squareOrderId && existing.squareOrderVersion !== null) {
        return json(
          {
            orderId: existing.orderId,
            expiresAt: existing.expiresAt,
            reused: true,
            totals: totals(existing),
            guestAccessToken: await guestToken(existing.orderId, !session, deps),
          },
          200,
        );
      }
      if (existing.squareOrderId)
        return json({ error: "Checkout cannot be migrated; start again" }, 409);
    }

    const normalizedEmailHash = deps.hashEmail(buyerEmail);
    const attempt = await deps.checkAttempt({
      tenantId,
      clientIp,
      userId: session?.user.id ?? null,
      normalizedEmailHash,
      deviceSessionId: parsed.data.deviceSessionId,
    });
    if (!attempt.allowed) {
      return json(
        { error: "Too many checkout attempts; please try again later" },
        429,
        attempt.retryAfterSeconds
          ? { "Retry-After": String(attempt.retryAfterSeconds) }
          : undefined,
      );
    }

    let reservation: CheckoutReservationResult;
    let cart: ResolvedCheckoutCart;
    let pricing: CheckoutPricingQuote;
    if (existing) {
      reservation = {
        orderId: existing.orderId,
        reused: true,
        expiresAt: existing.expiresAt,
        squarePaymentLinkId: existing.squarePaymentLinkId,
        squareOrderId: existing.squareOrderId,
        squarePaymentLinkUrl: existing.squarePaymentLinkUrl,
      };
      cart = { items: existing.items, subtotalCents: existing.subtotalCents };
      pricing = {
        shippingCents: existing.shippingCents,
        taxCents: 0,
        taxCalculationId: "square:pending",
        customerState: parsed.data.shippingAddress?.state ?? "SC",
      };
    } else {
      cart = await deps.resolveCart(tenantId, parsed.data.items);
      pricing = await deps.quote({
        tenantId,
        fulfillment: parsed.data.fulfillment,
        shippingAddress: parsed.data.shippingAddress,
        subtotalCents: cart.subtotalCents,
        items: cart.items,
      });
      const expiresAt = new Date(deps.now().getTime() + 15 * 60 * 1000);
      reservation = await deps.reserve({
        tenantId,
        userId: session?.user.id ?? null,
        guestEmail: session ? null : buyerEmail,
        fulfillment: parsed.data.fulfillment,
        idempotencyKey: parsed.data.idempotencyKey,
        cartHash,
        expiresAt,
        subtotalCents: cart.subtotalCents,
        shippingCents: pricing.shippingCents,
        taxCents: 0,
        totalCents: cart.subtotalCents + pricing.shippingCents,
        taxCalculationId: "square:pending",
        customerState: pricing.customerState,
        shippingAddress: parsed.data.shippingAddress,
        protectionEvidence: {
          version: 2,
          bot_verdict: bot.reason,
          client_ip_masked: maskIp(clientIp),
          normalized_email_hmac: normalizedEmailHash,
          device_session_id: parsed.data.deviceSessionId,
          created_at: deps.now().toISOString(),
        },
        items: cart.items,
      });
    }

    const squareOrder = await deps.createSquareOrder({
      localOrderId: reservation.orderId,
      idempotencyKey: parsed.data.idempotencyKey,
      fulfillment: parsed.data.fulfillment,
      buyerEmail,
      subtotalCents: cart.subtotalCents,
      shippingCents: pricing.shippingCents,
      shippingAddress: parsed.data.shippingAddress,
      items: cart.items,
    });
    try {
      await deps.attachSquareOrder(reservation.orderId, squareOrder);
    } catch (error) {
      try {
        await deps.cancelSquareOrder(
          squareOrder.id,
          squareOrder.version,
          crypto.randomUUID(),
        );
        await deps.releaseReservation(reservation.orderId, "square_order_attach_failed");
      } catch {
        // Preserve inventory if Square cancellation cannot be proved.
      }
      throw error;
    }

    return json(
      {
        orderId: reservation.orderId,
        expiresAt: reservation.expiresAt,
        reused: reservation.reused,
        totals: totals(squareOrder),
        guestAccessToken: await guestToken(reservation.orderId, !session, deps),
      },
      reservation.reused ? 200 : 201,
    );
  } catch (error) {
    deps.reportError(error);
    return json({ error: "Checkout is temporarily unavailable" }, 503);
  }
}
