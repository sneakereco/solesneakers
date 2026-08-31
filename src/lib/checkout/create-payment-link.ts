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
  paymentLinkRequestSchema,
  type PaymentLinkRequestItem,
} from "@/lib/checkout/payment-link-request";
import type { CheckoutBotVerdict } from "@/lib/security/checkout-bot";
import {
  isSquareHostedUrl,
  type HostedPaymentLink,
  type HostedPaymentLinkInput,
} from "@/lib/square/payment-links";
import type {
  CheckoutReservationResult,
  ExistingCheckout,
  ReserveCheckoutInput,
} from "@/repositories/checkout-reservation-repo";

type CheckoutSession = {
  user: { id: string; email: string };
} | null;

export type CreatePaymentLinkDependencies = {
  findTenantId(): Promise<string | null>;
  getAccess(tenantId: string): Promise<CheckoutAccessDecision>;
  verifyBrowser(): Promise<CheckoutBotVerdict>;
  getClientIp(request: NextRequest): string | null;
  getSession(): Promise<CheckoutSession>;
  hashEmail(email: string): string;
  findExisting(
    tenantId: string,
    idempotencyKey: string,
    cartHash: string,
  ): Promise<ExistingCheckout | null>;
  ensureCommerceReady(tenantId: string): Promise<void>;
  checkAttempt(identity: CheckoutAttemptIdentity): Promise<CheckoutAttemptDecision>;
  resolveCart(
    tenantId: string,
    items: PaymentLinkRequestItem[],
  ): Promise<ResolvedCheckoutCart>;
  quote(input: CheckoutPricingQuoteInput): Promise<CheckoutPricingQuote>;
  reserve(input: ReserveCheckoutInput): Promise<CheckoutReservationResult>;
  createGuestAccessToken(orderId: string): Promise<string>;
  createSquareLink(input: HostedPaymentLinkInput): Promise<HostedPaymentLink>;
  attachSquareLink(orderId: string, link: HostedPaymentLink): Promise<void>;
  deleteSquareLink(paymentLinkId: string): Promise<void>;
  markSquareLinkDeleted(orderId: string, paymentLinkId: string): Promise<void>;
  releaseReservation(orderId: string, reason: string): Promise<boolean>;
  reportError(error: unknown): void;
  now(): Date;
  siteUrl: string;
};

function json(
  body: Record<string, unknown>,
  status: number,
  headers?: HeadersInit,
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function maskIp(ip: string): string {
  if (ip.includes(":")) {
    return `${ip.split(":").slice(0, 4).join(":")}::/64`;
  }
  const octets = ip.split(".");
  return octets.length === 4 ? `${octets.slice(0, 3).join(".")}.0/24` : "unparseable";
}

function isFuture(iso: string, now: Date): boolean {
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

async function retireExpiredCheckout(
  existing: ExistingCheckout,
  deps: CreatePaymentLinkDependencies,
): Promise<void> {
  if (existing.squarePaymentLinkId && !existing.squarePaymentLinkDeletedAt) {
    await deps.deleteSquareLink(existing.squarePaymentLinkId);
    await deps.markSquareLinkDeleted(existing.orderId, existing.squarePaymentLinkId);
  }
  await deps.releaseReservation(existing.orderId, "checkout_expired");
}

async function createAndAttachSquareLink(
  input: HostedPaymentLinkInput,
  deps: CreatePaymentLinkDependencies,
): Promise<HostedPaymentLink> {
  const link = await deps.createSquareLink(input);
  try {
    await deps.attachSquareLink(input.localOrderId, link);
    return link;
  } catch (error) {
    try {
      await deps.deleteSquareLink(link.id);
      try {
        await deps.markSquareLinkDeleted(input.localOrderId, link.id);
      } catch {
        // The attach may have failed before the Square ID was stored locally.
        // Release below is still safe: the database refuses release if a live
        // attached link exists without deletion evidence.
      }
      await deps.releaseReservation(input.localOrderId, "square_link_attach_failed");
    } catch {
      // Preserve the reservation if Square-link retirement cannot be proved.
    }
    throw error;
  }
}

async function existingLinkResponse(
  existing: ExistingCheckout,
  deps: CreatePaymentLinkDependencies,
): Promise<Response | null> {
  if (
    existing.squarePaymentLinkId &&
    existing.squareOrderId &&
    existing.squarePaymentLinkUrl &&
    !existing.squarePaymentLinkDeletedAt &&
    isSquareHostedUrl(existing.squarePaymentLinkUrl)
  ) {
    const guestAccessToken = existing.guestEmail
      ? await deps.createGuestAccessToken(existing.orderId)
      : undefined;
    return json(
      {
        orderId: existing.orderId,
        url: existing.squarePaymentLinkUrl,
        expiresAt: existing.expiresAt,
        reused: true,
        guestAccessToken,
      },
      200,
    );
  }
  return null;
}

export async function createPaymentLinkHandler(
  request: NextRequest,
  deps: CreatePaymentLinkDependencies,
): Promise<Response> {
  try {
    const tenantId = await deps.findTenantId();
    if (!tenantId) {
      return json({ error: "Checkout is temporarily unavailable" }, 503);
    }

    const access = await deps.getAccess(tenantId);
    if (!access.open) {
      return json({ error: access.message }, 503);
    }

    const bot = await deps.verifyBrowser();
    if (!bot.allowed) {
      return json(
        { error: "Checkout verification failed" },
        bot.reason === "bot" ? 403 : 503,
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = paymentLinkRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return json({ error: "Invalid checkout request" }, 400);
    }

    const clientIp = deps.getClientIp(request);
    if (!clientIp) {
      return json({ error: "Checkout protection is temporarily unavailable" }, 503);
    }

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
    if (!buyerEmail) {
      return json({ error: "A buyer email is required" }, 400);
    }

    const cartHash = createCheckoutCartHash({
      tenantId,
      buyerEmail,
      fulfillment: parsed.data.fulfillment,
      shippingAddress: parsed.data.shippingAddress ?? null,
      items: parsed.data.items,
    });
    const existing = await deps.findExisting(
      tenantId,
      parsed.data.idempotencyKey,
      cartHash,
    );

    if (existing) {
      if (existing.cartHash !== cartHash) {
        return json({ error: "Checkout key conflicts with another cart" }, 409);
      }
      if (existing.status !== "pending") {
        return json({ error: "Checkout cannot be reused" }, 409);
      }
      if (!isFuture(existing.expiresAt, deps.now())) {
        await retireExpiredCheckout(existing, deps);
        return json({ error: "Checkout expired; start a new checkout" }, 409);
      }

      const reusableResponse = await existingLinkResponse(existing, deps);
      if (reusableResponse) {
        return reusableResponse;
      }

      const link = await createAndAttachSquareLink(
        {
          localOrderId: existing.orderId,
          tenantId,
          idempotencyKey: parsed.data.idempotencyKey,
          fulfillment: existing.fulfillment,
          buyerEmail,
          redirectUrl: new URL(
            `/checkout/processing?orderId=${encodeURIComponent(existing.orderId)}`,
            deps.siteUrl,
          ).toString(),
          subtotalCents: existing.subtotalCents,
          shippingCents: existing.shippingCents,
          shippingAddress: parsed.data.shippingAddress ?? null,
          items: existing.items,
        },
        deps,
      );
      const guestAccessToken = existing.guestEmail
        ? await deps.createGuestAccessToken(existing.orderId)
        : undefined;
      return json(
        {
          orderId: existing.orderId,
          url: link.url,
          expiresAt: existing.expiresAt,
          reused: true,
          guestAccessToken,
        },
        200,
      );
    }

    await deps.ensureCommerceReady(tenantId);

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

    const cart = await deps.resolveCart(tenantId, parsed.data.items);
    const pricing = await deps.quote({
      tenantId,
      fulfillment: parsed.data.fulfillment,
      shippingAddress: parsed.data.shippingAddress ?? null,
      subtotalCents: cart.subtotalCents,
      items: cart.items,
    });
    const totalCents = cart.subtotalCents + pricing.shippingCents + pricing.taxCents;
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
      throw new Error("checkout_pricing_invalid");
    }

    const expiresAt = new Date(deps.now().getTime() + 15 * 60 * 1000);
    const reservation = await deps.reserve({
      tenantId,
      userId: session?.user.id ?? null,
      guestEmail: session ? null : buyerEmail,
      fulfillment: parsed.data.fulfillment,
      idempotencyKey: parsed.data.idempotencyKey,
      cartHash,
      expiresAt,
      subtotalCents: cart.subtotalCents,
      shippingCents: pricing.shippingCents,
      taxCents: pricing.taxCents,
      totalCents,
      taxCalculationId: pricing.taxCalculationId,
      customerState: pricing.customerState,
      shippingAddress: parsed.data.shippingAddress ?? null,
      protectionEvidence: {
        version: 1,
        bot_verdict: bot.reason,
        client_ip_masked: maskIp(clientIp),
        normalized_email_hmac: normalizedEmailHash,
        device_session_id: parsed.data.deviceSessionId,
        tax_calculation_id: pricing.taxCalculationId,
        customer_state: pricing.customerState,
        created_at: deps.now().toISOString(),
      },
      items: cart.items,
    });

    const link = await createAndAttachSquareLink(
      {
        localOrderId: reservation.orderId,
        tenantId,
        idempotencyKey: parsed.data.idempotencyKey,
        fulfillment: parsed.data.fulfillment,
        buyerEmail,
        redirectUrl: new URL(
          `/checkout/processing?orderId=${encodeURIComponent(reservation.orderId)}`,
          deps.siteUrl,
        ).toString(),
        subtotalCents: cart.subtotalCents,
        shippingCents: pricing.shippingCents,
        shippingAddress: parsed.data.shippingAddress ?? null,
        items: cart.items,
      },
      deps,
    );
    const guestAccessToken = session
      ? undefined
      : await deps.createGuestAccessToken(reservation.orderId);

    return json(
      {
        orderId: reservation.orderId,
        url: link.url,
        expiresAt: reservation.expiresAt,
        reused: reservation.reused,
        guestAccessToken,
      },
      reservation.reused ? 200 : 201,
    );
  } catch (error) {
    deps.reportError(error);
    return json({ error: "Checkout is temporarily unavailable" }, 503);
  }
}
