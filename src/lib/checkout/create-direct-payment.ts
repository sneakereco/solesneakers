import type { PaymentAttempt } from "@/Modules/Checkout/Source/Features/Payments/attempt-contract";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  dispatchPayment,
  type DispatchOperations,
} from "@/Modules/Checkout/Source/Features/Payments/dispatch-payment";
import {
  permitMatchesLegacyTenant,
  type ConsumedPaymentPermit,
} from "@/Modules/Checkout/Source/Features/ContractCompatibility/payment-permit-reader";
import {
  checkoutBillingAddressSchema,
  checkoutPickupContactSchema,
  checkoutShippingAddressSchema,
  directPaymentRequestSchema,
} from "./checkout-request";
import type { CheckoutAccessDecision } from "./checkout-access";
import type { CheckoutAttemptDecision } from "./checkout-attempt-limit";
import type { DirectPaymentResult } from "@/lib/square/payments";
import type {
  ShippingAddress,
  ShippingValidationResult,
} from "./shipping-address-validation";
import type { PaymentCheckout } from "@/repositories/checkout-reservation-repo";

export type CreateDirectPaymentDependencies = DispatchOperations & {
  validateShippingAddress(address: ShippingAddress): Promise<ShippingValidationResult>;
  consumePermit(token: string): Promise<ConsumedPaymentPermit | null>;
  loadOrder(orderId: string): Promise<PaymentCheckout | null>;
  getSession(): Promise<{ user: { id: string } } | null>;
  getAccess(tenantId: string): Promise<CheckoutAccessDecision>;
  enqueueLegacyInquiry(orderId: string): Promise<void>;
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
  reportError(error: unknown): void;
  now(): Date;
};

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function observedStatus(attempt: PaymentAttempt) {
  switch (attempt.state) {
    case "succeeded":
      return "COMPLETED";
    case "pending":
      return "PENDING";
    case "declined":
      return "FAILED";
    case "canceled":
      return attempt.providerPaymentId ? "CANCELED" : "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}

type Invalid = { status: number; message: string };
const billing = checkoutBillingAddressSchema.omit({
  givenName: true,
  familyName: true,
  phone: true,
});
async function validate(
  order: PaymentCheckout,
  permit: ConsumedPaymentPermit,
  deps: CreateDirectPaymentDependencies,
): Promise<Invalid | null> {
  if (
    order.status !== "pending" ||
    !(Date.parse(order.expiresAt) > deps.now().getTime()) ||
    !order.squareOrderId ||
    order.squareOrderVersion === null ||
    !billing.safeParse(order.billingAddress).success
  )
    return {
      status: 409,
      message: "Checkout details changed. Return to checkout and review them.",
    };
  if (
    order.fulfillment === "pickup" &&
    !checkoutPickupContactSchema.safeParse(order.pickupContact).success
  )
    return {
      status: 409,
      message: "Pickup contact is incomplete. Return to checkout and review it.",
    };
  if (order.fulfillment === "ship") {
    const address = checkoutShippingAddressSchema.safeParse(order.shippingAddress);
    const invalid = {
      status: 409,
      message: "Shipping address needs verification. Return to checkout and review it.",
    };
    if (!address.success) return invalid;
    if (permit.method !== "applePay" && !order.shippingAddressOverrideConfirmed) {
      const result = await deps
        .validateShippingAddress(address.data)
        .catch(() => ({ status: "unavailable" }));
      if (result.status === "unavailable")
        return {
          status: 503,
          message: "Address verification is temporarily unavailable. Please retry.",
        };
      if (result.status !== "valid") return invalid;
    }
  }
  const access = await deps.getAccess(order.tenantId);
  return access.open ? null : { status: 503, message: access.message };
}

// A valid bearer can still resolve an already submitted attempt after its source has expired.
const envelope = directPaymentRequestSchema.extend({ sourceId: z.unknown().optional() });
export async function createDirectPaymentHandler(
  request: NextRequest,
  deps: CreateDirectPaymentDependencies,
): Promise<Response> {
  const body = envelope.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Invalid payment request" }, 400);
  let observation: Record<string, unknown> | null = null;
  try {
    const permit = await deps.consumePermit(body.data.permit);
    if (!permit) return json({ error: "Payment authorization expired" }, 403);
    const order = await deps.loadOrder(permit.orderId);
    if (
      !order ||
      order.orderId !== permit.orderId ||
      !permitMatchesLegacyTenant(permit, order.tenantId) ||
      order.deviceSessionId !== permit.deviceSessionId ||
      order.cartHash !== permit.cartHash ||
      order.totalCents !== permit.totalCents
    )
      return json({ error: "Checkout details changed; start again" }, 409);

    let ownerBinding: string;
    if (order.userId !== null) {
      const session = await deps.getSession();
      if (!session || session.user.id !== order.userId)
        return json({ error: "Order access denied" }, 403);
      ownerBinding = `account:${session.user.id}`;
    } else {
      // Only the grant-verifying issuer may mint this two-minute, one-use guest bearer.
      if (!("ownerBinding" in permit) || permit.ownerBinding !== `order:${order.orderId}`)
        return json({ error: "Order access denied" }, 403);
      ownerBinding = permit.ownerBinding;
    }
    if ("ownerBinding" in permit && permit.ownerBinding !== ownerBinding)
      return json({ error: "Order access denied" }, 403);
    observation = {
      orderId: order.orderId,
      paymentId: null,
      status: "UNKNOWN",
      statusUrl: `/checkout/processing?orderId=${encodeURIComponent(order.orderId)}`,
    };
    if (order.financialReview) return json(observation, 202);
    const attempt = await deps.readCurrentAttempt(order.orderId);
    if (!attempt) {
      try {
        await deps.enqueueLegacyInquiry(order.orderId);
      } catch {
        deps.reportError(new Error("checkout_legacy_inquiry_unavailable"));
        return json(
          { ...observation, error: "Payment status is temporarily unavailable" },
          503,
        );
      }
      return json(observation, 202);
    }
    observation.attemptId = attempt.id;
    let failureStatus = 409;
    const projection: { payment?: DirectPaymentResult; observed: PaymentAttempt } = {
      observed: attempt,
    };
    const source = directPaymentRequestSchema.shape.sourceId.safeParse(
      body.data.sourceId,
    );
    const result = await dispatchPayment(
      { permit, sourceId: source.success ? source.data : "" },
      {
        ...deps,
        order,
        attempt,
        ownerBinding,
        onAttemptObserved: (observed) => {
          projection.observed = observed;
        },
        recordAttemptOutcome: async (input) => {
          const saved = await deps.recordAttemptOutcome(input);
          if (input.state === "declined" || input.state === "canceled") {
            // Only the claimant records a newly received decline. Observers never increment the limiter.
            await deps
              .recordDecline({
                tenantId: order.tenantId,
                deviceSessionId: permit.deviceSessionId,
              })
              .catch(() =>
                deps.reportError(new Error("checkout_decline_counter_unavailable")),
              );
          }
          return saved;
        },
        validate: async () => {
          const invalid = await validate(order, permit, deps);
          if (invalid) failureStatus = invalid.status;
          return invalid?.message ?? null;
        },
        save: async (payment) => {
          await deps.savePaymentId(order.orderId, payment.id, payment, permit.method);
          projection.payment = payment;
        },
      },
    );
    if (result.kind === "not_submitted")
      return json({ error: result.message, code: result.code }, failureStatus);
    if (result.kind === "declined") {
      return json(
        {
          error: "Payment was declined. Check your details and try again.",
          attemptId: result.attemptId,
          paymentId: projection.observed.providerPaymentId,
          status: observedStatus(projection.observed),
        },
        402,
      );
    }
    return json(
      {
        ...observation,
        attemptId: result.attemptId,
        paymentId: projection.payment?.id ?? projection.observed.providerPaymentId,
        status: projection.payment?.status ?? observedStatus(projection.observed),
      },
      202,
    );
  } catch {
    deps.reportError(new Error("checkout_payment_unavailable"));
    return observation
      ? json(observation, 202)
      : json({ error: "Checkout protection is temporarily unavailable" }, 503);
  }
}
