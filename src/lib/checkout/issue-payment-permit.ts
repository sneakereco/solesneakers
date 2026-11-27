import type { CheckoutPaymentAttemptRepository } from "@/Modules/Checkout/Source/Features/Payments/attempt-repository";

import type { NextRequest } from "next/server";

import type { CheckoutAccessDecision } from "@/lib/checkout/checkout-access";
import type { CheckoutAttemptDecision } from "@/lib/checkout/checkout-attempt-limit";
import { normalizeCheckoutEmail } from "@/lib/checkout/checkout-identity";
import { paymentPermitRequestSchema } from "@/lib/checkout/checkout-request";
import type { PaymentPermitPayload } from "@/lib/checkout/payment-permit";
import type { CheckoutBotVerdict } from "@/lib/security/checkout-bot";
import type { TurnstileVerdict } from "@/lib/security/turnstile";
import type { PaymentCheckout } from "@/repositories/checkout-reservation-repo";

type CheckoutSession = { user: { id: string; email: string } } | null;

export type IssuePaymentPermitDependencies = {
  refusalDisposition(order: PaymentCheckout): Promise<"refuse" | "observe" | "deny">;
  getOrCreateAttempt: CheckoutPaymentAttemptRepository["getOrCreateAttempt"];
  findTenantId(): Promise<string | null>;
  getAccess(tenantId: string): Promise<CheckoutAccessDecision>;
  verifyBrowser(): Promise<CheckoutBotVerdict>;
  getClientIp(request: NextRequest): string | null;
  getSession(): Promise<CheckoutSession>;
  loadOrder(orderId: string): Promise<PaymentCheckout | null>;
  validateGuestAccess(orderId: string, token: string): Promise<boolean>;
  verifyTurnstile(token: string, clientIp: string): Promise<TurnstileVerdict>;
  checkPaymentAttempt(input: {
    tenantId: string;
    orderId: string;
    clientIp: string;
    shopperBinding: string;
  }): Promise<CheckoutAttemptDecision>;
  hashEmail(email: string): string;
  issuePermit(
    payload: PaymentPermitPayload & { attemptId: string; ownerBinding: string },
  ): Promise<{
    token: string;
    expiresInSeconds: number;
  }>;
  reportError(error: unknown): void;
  now(): Date;
};

function json(body: Record<string, unknown>, status: number, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function isUsable(order: PaymentCheckout, now: Date): boolean {
  const expiresAt = new Date(order.expiresAt).getTime();
  return (
    order.status === "pending" &&
    Boolean(order.squareOrderId) &&
    order.squareOrderVersion !== null &&
    Number.isFinite(expiresAt) &&
    expiresAt > now.getTime()
  );
}

function originalOrderStatus(order: PaymentCheckout): Response {
  return json(
    {
      code: "CHECKOUT_RECOVERY_REQUIRED",
      error: "Check the original order status for the latest payment information.",
      orderId: order.orderId,
      statusUrl: "/checkout/processing?orderId=" + encodeURIComponent(order.orderId),
    },
    409,
  );
}

async function admissionRefusal(
  order: PaymentCheckout,
  deps: IssuePaymentPermitDependencies,
  refusal: Response,
): Promise<Response> {
  try {
    const disposition = await deps.refusalDisposition(order);
    if (disposition === "refuse") return refusal;
    if (disposition === "deny") return json({ error: "Order access denied" }, 403);
  } catch {
    deps.reportError(new Error("checkout_permit_evidence_unavailable"));
  }
  return originalOrderStatus(order);
}

export async function issuePaymentPermitHandler(
  request: NextRequest,
  deps: IssuePaymentPermitDependencies,
): Promise<Response> {
  try {
    const tenantId = await deps.findTenantId();
    if (!tenantId) {
      return json({ error: "Checkout is temporarily unavailable" }, 503);
    }
    const bot = await deps.verifyBrowser();
    if (!bot.allowed) {
      return json(
        { error: "Checkout verification failed" },
        bot.reason === "bot" ? 403 : 503,
      );
    }

    const parsed = paymentPermitRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return json({ error: "Invalid payment request" }, 400);
    }
    const clientIp = deps.getClientIp(request);
    if (!clientIp) {
      return json({ error: "Checkout protection is temporarily unavailable" }, 503);
    }

    const [session, order] = await Promise.all([
      deps.getSession(),
      deps.loadOrder(parsed.data.orderId),
    ]);
    if (!order || order.tenantId !== tenantId) {
      return json({ error: "Order not found" }, 404);
    }
    if (order.deviceSessionId !== parsed.data.deviceSessionId) {
      return json({ error: "Checkout verification failed" }, 403);
    }

    const isGuest = order.userId === null;
    if (isGuest) {
      const token = parsed.data.guestAccessToken;
      if (!token || !(await deps.validateGuestAccess(order.orderId, token))) {
        return json({ error: "Order access denied" }, 403);
      }
    } else if (session?.user.id !== order.userId) {
      return json({ error: "Order access denied" }, 403);
    }

    if (order.financialReview) return originalOrderStatus(order);
    // assertCheckoutOpen converts control/configuration read failures to a closed decision.
    const access = await deps.getAccess(tenantId);
    if (!access.open) {
      return admissionRefusal(order, deps, json({ error: access.message }, 503));
    }

    if (!isUsable(order, deps.now()))
      return json({ error: "Checkout is no longer payable" }, 409);
    const email = order.guestEmail ?? session?.user.email;
    if (!email) {
      throw new Error("checkout_payment_email_missing");
    }
    const normalizedEmailHash = deps.hashEmail(normalizeCheckoutEmail(email));
    if (isGuest) {
      const token = parsed.data.turnstileToken;
      if (!token) {
        return json({ error: "Checkout verification failed" }, 403);
      }
      const verdict = await deps.verifyTurnstile(token, clientIp);
      if (!verdict.allowed) {
        return json(
          { error: "Checkout verification failed" },
          verdict.reason === "invalid" ? 403 : 503,
        );
      }
    }

    const ownerBinding = isGuest
      ? `order:${order.orderId}`
      : `account:${session!.user.id}`;
    let attempt: CheckoutAttemptDecision;
    try {
      attempt = await deps.checkPaymentAttempt({
        tenantId,
        orderId: order.orderId,
        clientIp,
        shopperBinding: order.userId
          ? "account:" + order.userId
          : order.guestContextHash
            ? "guest:" + order.guestContextHash
            : "order:" + order.orderId,
      });
    } catch {
      deps.reportError(new Error("checkout_payment_permit_unavailable"));
      return admissionRefusal(
        order,
        deps,
        json({ error: "Checkout is temporarily unavailable" }, 503),
      );
    }
    if (!attempt.allowed) {
      return admissionRefusal(
        order,
        deps,
        json(
          { error: "Too many payment attempts; please try again later" },
          429,
          attempt.retryAfterSeconds
            ? { "Retry-After": String(attempt.retryAfterSeconds) }
            : undefined,
        ),
      );
    }

    const financialAttempt = await deps.getOrCreateAttempt({
      orderId: order.orderId,
      method: parsed.data.method,
      ownerBinding,
    });
    const permit = await deps.issuePermit({
      attemptId: financialAttempt.id,
      ownerBinding,
      tenantId,
      orderId: order.orderId,
      cartHash: order.cartHash,
      totalCents: order.totalCents,
      method: parsed.data.method,
      deviceSessionId: parsed.data.deviceSessionId,
      normalizedEmailHash,
      squareIdempotencyKey: financialAttempt.squareIdempotencyKey,
    });
    return json(
      {
        permit: permit.token,
        expiresAt: new Date(
          deps.now().getTime() + permit.expiresInSeconds * 1000,
        ).toISOString(),
      },
      201,
    );
  } catch {
    deps.reportError(new Error("checkout_payment_permit_unavailable"));
    return json({ error: "Checkout is temporarily unavailable" }, 503);
  }
}
