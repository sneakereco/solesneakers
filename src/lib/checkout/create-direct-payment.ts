import { randomUUID } from "node:crypto";
import {
  paymentAttemptId,
  type OperationalOutcome,
} from "@/Modules/Analytics/Source/Features/CommerceFacts/operational-outcome";
import type { NextRequest } from "next/server";

import {
  checkoutShippingAddressSchema,
  checkoutPickupContactSchema,
  directPaymentRequestSchema,
} from "@/lib/checkout/checkout-request";
import {
  permitMatchesLegacyTenant,
  type ConsumedPaymentPermit,
} from "@/Modules/Checkout/Source/Features/ContractCompatibility/payment-permit-reader";
import type { CheckoutAttemptDecision } from "@/lib/checkout/checkout-attempt-limit";
import type { DirectPaymentInput, DirectPaymentResult } from "@/lib/square/payments";
import type {
  ShippingAddress,
  ShippingValidationResult,
} from "@/lib/checkout/shipping-address-validation";
import type { PaymentCheckout } from "@/repositories/checkout-reservation-repo";

export type CreateDirectPaymentDependencies = {
  outcome?(value: OperationalOutcome): void;
  validateShippingAddress(address: ShippingAddress): Promise<ShippingValidationResult>;
  consumePermit(token: string): Promise<ConsumedPaymentPermit | null>;
  loadOrder(orderId: string): Promise<PaymentCheckout | null>;
  createPayment(input: DirectPaymentInput): Promise<DirectPaymentResult>;
  savePaymentId(
    orderId: string,
    paymentId: string,
    payment: DirectPaymentResult,
    method: ConsumedPaymentPermit["method"],
  ): Promise<void>;
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

function matches(order: PaymentCheckout, permit: ConsumedPaymentPermit, now: Date) {
  const expiresAt = new Date(order.expiresAt).getTime();
  return (
    permitMatchesLegacyTenant(permit, order.tenantId) &&
    order.orderId === permit.orderId &&
    order.cartHash === permit.cartHash &&
    order.totalCents === permit.totalCents &&
    order.deviceSessionId === permit.deviceSessionId &&
    order.status === "pending" &&
    Boolean(order.squareOrderId) &&
    Boolean(order.billingAddress) &&
    Number.isFinite(expiresAt) &&
    expiresAt > now.getTime()
  );
}

export async function createDirectPaymentHandler(
  request: NextRequest,
  deps: CreateDirectPaymentDependencies,
): Promise<Response> {
  const effectiveAt = deps.now().toISOString();
  const parsed = directPaymentRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return json({ error: "Invalid payment request" }, 400);
  }

  let permit: ConsumedPaymentPermit | null;
  try {
    permit = await deps.consumePermit(parsed.data.permit);
  } catch (error) {
    deps.reportError(error);
    deps.outcome?.({
      attemptId: randomUUID(),
      effectiveAt,
      resolvedAt: deps.now().toISOString(),
      orderId: null,
      method: null,
      stage: "verification",
      outcome: "failed",
      reason: "unavailable",
    });
    return json({ error: "Checkout protection is temporarily unavailable" }, 503);
  }
  if (!permit) {
    deps.outcome?.({
      attemptId: randomUUID(),
      effectiveAt,
      resolvedAt: deps.now().toISOString(),
      orderId: null,
      method: null,
      stage: "verification",
      outcome: "expired",
      reason: "expired",
    });
    return json({ error: "Payment authorization expired" }, 403);
  }

  const attemptId = paymentAttemptId(permit.squareIdempotencyKey);
  const command = permit;
  const report = (
    outcome: OperationalOutcome["outcome"],
    reason: OperationalOutcome["reason"],
    stage: OperationalOutcome["stage"] = "payment",
  ) =>
    deps.outcome?.({
      attemptId,
      effectiveAt,
      resolvedAt:
        outcome === "unknown" || outcome === "pending" ? null : deps.now().toISOString(),
      orderId: command.orderId,
      method: command.method,
      stage,
      outcome,
      reason,
    });
  let providerCalled = false;
  let providerObserved = false;
  let declineIdentity: { tenantId: string; deviceSessionId: string } | null = null;
  try {
    const order = await deps.loadOrder(permit.orderId);
    if (!order || !matches(order, permit, deps.now())) {
      report("failed", "invalid", "verification");
      return json({ error: "Checkout details changed; start again" }, 409);
    }
    declineIdentity = {
      tenantId: order.tenantId,
      deviceSessionId: permit.deviceSessionId,
    };

    if (
      order.fulfillment === "pickup" &&
      !checkoutPickupContactSchema.safeParse(order.pickupContact).success
    ) {
      report("failed", "invalid", "verification");
      return json(
        {
          error:
            "Pickup contact is incomplete. Return to checkout and review it. You have not been charged.",
        },
        409,
      );
    }

    // Require a complete stored address for every shipment. Express wallets supply
    // their destination directly; only other methods require Shippo deliverability.
    if (order.fulfillment === "ship") {
      const address = checkoutShippingAddressSchema.safeParse(order.shippingAddress);
      if (!address.success) {
        report("failed", "invalid", "verification");
        return json(
          {
            error:
              "Shipping address needs verification. Return to checkout and review it. You have not been charged.",
          },
          409,
        );
      }
      if (permit.method !== "applePay" && !order.shippingAddressOverrideConfirmed) {
        let validation: ShippingValidationResult;
        try {
          validation = await deps.validateShippingAddress(address.data);
        } catch {
          report("failed", "unavailable", "verification");
          return json(
            {
              error:
                "Address verification is temporarily unavailable. Please retry. You have not been charged.",
            },
            503,
          );
        }
        if (validation.status !== "valid") {
          report(
            "failed",
            validation.status === "unavailable" ? "unavailable" : "invalid",
            "verification",
          );
          return json(
            {
              error:
                validation.status === "unavailable"
                  ? "Address verification is temporarily unavailable. Please retry. You have not been charged."
                  : "Shipping address needs verification. Return to checkout and review it. You have not been charged.",
            },
            validation.status === "unavailable" ? 503 : 409,
          );
        }
      }
    }

    providerCalled = true;
    const payment = await deps.createPayment({
      localOrderId: order.orderId,
      squareOrderId: order.squareOrderId!,
      sourceId: parsed.data.sourceId,
      idempotencyKey: permit.squareIdempotencyKey,
      totalCents: permit.totalCents,
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
    });
    providerObserved = true;
    if (payment.status === "CANCELED" || payment.status === "FAILED") {
      report(
        payment.status === "CANCELED" ? "canceled" : "failed",
        payment.status === "CANCELED" ? "canceled" : "declined",
      );
      await deps.recordDecline(declineIdentity);
      return json(
        { error: "Payment was declined. Check your details and try again." },
        402,
      );
    }
    report(payment.status === "COMPLETED" ? "succeeded" : "pending", "none");
    await deps.savePaymentId(order.orderId, payment.id, payment, permit.method);
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
    if (deps.isDefiniteDecline(error) && declineIdentity) {
      if (!providerObserved) report("failed", "declined");
      await deps.recordDecline(declineIdentity);
      return json(
        { error: "Payment was declined. Check your details and try again." },
        402,
      );
    }
    if (!providerObserved)
      report(
        providerCalled ? "unknown" : "failed",
        error instanceof Error &&
          /timeout|timed.out/i.test(error.name + " " + error.message)
          ? "timeout"
          : "unavailable",
        providerCalled ? "payment" : "verification",
      );
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
