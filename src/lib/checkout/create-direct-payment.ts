import type { NextRequest } from "next/server";

import { directPaymentRequestSchema } from "@/lib/checkout/checkout-request";
import type { PaymentPermitPayload } from "@/lib/checkout/payment-permit";
import type { CheckoutAttemptDecision } from "@/lib/checkout/checkout-attempt-limit";
import type { DirectPaymentInput, DirectPaymentResult } from "@/lib/square/payments";
import type { PaymentCheckout } from "@/repositories/checkout-reservation-repo";

export type CreateDirectPaymentDependencies = {
  consumePermit(token: string): Promise<PaymentPermitPayload | null>;
  loadOrder(orderId: string): Promise<PaymentCheckout | null>;
  createPayment(input: DirectPaymentInput): Promise<DirectPaymentResult>;
  savePaymentId(orderId: string, paymentId: string): Promise<void>;
  recordDecline(input: {
    tenantId: string;
    deviceSessionId: string;
  }): Promise<CheckoutAttemptDecision>;
  isDefiniteDecline(error: unknown): boolean;
  reportError(error: unknown): void;
  now(): Date;
};

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function statusUrl(orderId: string): string {
  return `/checkout/processing?orderId=${encodeURIComponent(orderId)}`;
}

function matches(order: PaymentCheckout, permit: PaymentPermitPayload, now: Date) {
  const expiresAt = new Date(order.expiresAt).getTime();
  return (
    order.tenantId === permit.tenantId &&
    order.cartHash === permit.cartHash &&
    order.totalCents === permit.totalCents &&
    order.deviceSessionId === permit.deviceSessionId &&
    order.status === "pending" &&
    Boolean(order.squareOrderId) &&
    Number.isFinite(expiresAt) &&
    expiresAt > now.getTime()
  );
}

export async function createDirectPaymentHandler(
  request: NextRequest,
  deps: CreateDirectPaymentDependencies,
): Promise<Response> {
  const parsed = directPaymentRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return json({ error: "Invalid payment request" }, 400);

  let permit: PaymentPermitPayload | null;
  try {
    permit = await deps.consumePermit(parsed.data.permit);
  } catch (error) {
    deps.reportError(error);
    return json({ error: "Checkout protection is temporarily unavailable" }, 503);
  }
  if (!permit) return json({ error: "Payment authorization expired" }, 403);

  try {
    const order = await deps.loadOrder(permit.orderId);
    if (!order || !matches(order, permit, deps.now())) {
      return json({ error: "Checkout details changed; start again" }, 409);
    }

    const payment = await deps.createPayment({
      localOrderId: order.orderId,
      squareOrderId: order.squareOrderId!,
      sourceId: parsed.data.sourceId,
      idempotencyKey: permit.squareIdempotencyKey,
      totalCents: permit.totalCents,
      shippingAddress: order.shippingAddress,
    });
    if (payment.status === "CANCELED" || payment.status === "FAILED") {
      await deps.recordDecline({
        tenantId: permit.tenantId,
        deviceSessionId: permit.deviceSessionId,
      });
      return json(
        { error: "Payment was declined. Check your details and try again." },
        402,
      );
    }
    await deps.savePaymentId(order.orderId, payment.id);
    return json(
      {
        orderId: order.orderId,
        paymentId: payment.id,
        status: payment.status,
        statusUrl: statusUrl(order.orderId),
      },
      202,
    );
  } catch (error) {
    deps.reportError(error);
    if (deps.isDefiniteDecline(error)) {
      await deps.recordDecline({
        tenantId: permit.tenantId,
        deviceSessionId: permit.deviceSessionId,
      });
      return json(
        { error: "Payment was declined. Check your details and try again." },
        402,
      );
    }
    return json(
      {
        orderId: permit.orderId,
        paymentId: null,
        status: "UNKNOWN",
        statusUrl: statusUrl(permit.orderId),
      },
      202,
    );
  }
}
