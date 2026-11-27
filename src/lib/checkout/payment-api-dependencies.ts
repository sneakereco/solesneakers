import {
  canReportNegativeCheckout,
  permitRefusalDisposition,
} from "@/Modules/Orders/Source/Features/OrderStatus/financial-evidence";
import { deadlineFetch } from "@/Modules/Checkout/Source/Features/Recovery/recovery-worker";
import { CheckoutProviderCapacity } from "@/lib/checkout/checkout-attempt-limit";
import { checkoutAdmissionBudgets } from "@/Modules/Checkout/Source/Features/Operations/admission";
import {
  CheckoutPaymentAttemptRepository,
  readCurrentPaymentAttempt,
} from "@/Modules/Checkout/Source/Features/Payments/attempt-repository";
import { CheckoutRecoveryRepository } from "@/Modules/Checkout/Source/Features/Recovery/recovery-repository";
import { scheduleOperationalOutcome } from "@/Modules/Analytics/Source/Features/CommerceFacts/operational-outcome";
import { validateShippingAddress } from "@/lib/shipping/validate-shipping-address";
import { env } from "@/config/env";
import { getServerSession } from "@/lib/auth/session";
import { assertCheckoutOpen } from "@/lib/checkout/checkout-access";
import { createCheckoutAttemptLimiter } from "@/lib/checkout/checkout-attempt-limit";
import {
  getCheckoutIdentitySecret,
  hashNormalizedCheckoutEmail,
} from "@/lib/checkout/checkout-identity";
import type { CreateDirectPaymentDependencies } from "@/lib/checkout/create-direct-payment";
import type { IssuePaymentPermitDependencies } from "@/lib/checkout/issue-payment-permit";
import { createPaymentPermitStore } from "@/lib/checkout/payment-permit";
import { getTrustedClientIp } from "@/lib/http/client-ip";
import { verifyCheckoutBrowser } from "@/lib/security/checkout-bot";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createSquarePaymentsGateway } from "@/lib/square/client";
import { squareDeclineCode } from "@/lib/square/payments";
import { recordSquarePaymentDetails } from "@/lib/square/payment-details";
import { promptSquareAttempt } from "@/lib/square/financial-inquiry-dependencies";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";
import {
  CheckoutReservationRepository,
  type PaymentCheckout,
} from "@/repositories/checkout-reservation-repo";
import { OrdersRepository } from "@/repositories/orders-repo";
import { TenantRepository } from "@/repositories/tenant-repo";
import { OrderAccessTokenService } from "@/services/order-access-token-service";

function orderOwner(order: PaymentCheckout) {
  return {
    id: order.orderId,
    user_id: order.userId,
    tenant_id: order.tenantId,
    checkout_guest_context_hash: order.guestContextHash ?? null,
  };
}

function checkoutHostname(): string {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) {
    throw new Error("checkout_site_url_missing");
  }
  return new URL(value).hostname;
}

export function createIssuePaymentPermitDependencies(
  requestId: string,
): IssuePaymentPermitDependencies {
  const supabase = createSupabaseAdminClient();
  const tenants = new TenantRepository(supabase);
  const reservations = new CheckoutReservationRepository(supabase);
  const accessTokens = new OrderAccessTokenService(supabase);
  const limiter = createCheckoutAttemptLimiter(supabase);
  const permits = createPaymentPermitStore();
  const attempts = new CheckoutPaymentAttemptRepository(supabase);

  return {
    getOrCreateAttempt: (input) => attempts.getOrCreateAttempt(input),
    refusalDisposition: (order) => permitRefusalDisposition(orderOwner(order), supabase),
    findTenantId: () => tenants.getFirstTenantId(),
    getAccess: (tenantId) => assertCheckoutOpen(tenantId, "gateway_attempt"),
    verifyBrowser: verifyCheckoutBrowser,
    getClientIp: getTrustedClientIp,
    getSession: getServerSession,
    loadOrder: (orderId) => reservations.findPaymentCheckout(orderId),
    validateGuestAccess: (orderId, token) =>
      accessTokens.validateToken({ orderId, token }),
    verifyTurnstile: (token, remoteIp) => {
      if (!env.TURNSTILE_SECRET_KEY) {
        return Promise.resolve({ allowed: false, reason: "unavailable" as const });
      }
      return verifyTurnstile(
        { token, remoteIp },
        {
          secretKey: env.TURNSTILE_SECRET_KEY,
          expectedHostname: checkoutHostname(),
          expectedAction: "checkout_payment",
          fetch,
        },
      );
    },
    checkPaymentAttempt: (input) => limiter.coarse(input.clientIp),
    hashEmail: (email) => hashNormalizedCheckoutEmail(email, getCheckoutIdentitySecret()),
    issuePermit: (payload) => permits.issue(payload),
    reportError: (error) =>
      logError(error, { layer: "api", route: "/api/checkout/payment-permit", requestId }),
    now: () => new Date(),
  };
}

export function createDirectPaymentDependencies(
  requestId: string,
): CreateDirectPaymentDependencies {
  const supabase = createSupabaseAdminClient();
  const reservations = new CheckoutReservationRepository(supabase);
  const orders = new OrdersRepository(supabase);
  const limiter = createCheckoutAttemptLimiter(supabase);
  const permits = createPaymentPermitStore();
  const attempts = new CheckoutPaymentAttemptRepository(supabase);
  const capacity = new CheckoutProviderCapacity(supabase, checkoutAdmissionBudgets);
  let gatewaySignal: AbortSignal | null = null;
  let payments: ReturnType<typeof createSquarePaymentsGateway> | null = null;
  const getPayments = () => {
    if (!gatewaySignal) throw Error("checkout_provider_capacity_required");
    return (payments ??= createSquarePaymentsGateway(gatewaySignal));
  };

  return {
    getSession: getServerSession,
    getAccess: (tenantId) => assertCheckoutOpen(tenantId, "gateway_attempt"),
    canReportNegative: (order, attempt) =>
      canReportNegativeCheckout(orderOwner(order), attempt, supabase),
    readCurrentAttempt: (orderId) => readCurrentPaymentAttempt(supabase, orderId),
    beginDispatch: (input) => attempts.beginDispatch(input),
    recordAttemptOutcome: async (input) => {
      const attempt = await attempts.recordAttemptOutcome(input);
      if (["succeeded", "pending", "unknown"].includes(attempt.state))
        promptSquareAttempt(supabase, attempt.orderId, attempt.id);
      return attempt;
    },
    fingerprints: (input) =>
      getPayments().fingerprints(input, getCheckoutIdentitySecret()),
    enqueueLegacyInquiry: (orderId) =>
      new CheckoutRecoveryRepository(supabase).enqueueRecovery({
        kind: "reconcile_payment",
        orderId,
        uniqueKey: `legacy_payment_order:${orderId}`,
        dueAt: new Date().toISOString(),
        reason: "legacy_dispatch_unproven",
      }),
    validateShippingAddress: (address) =>
      capacity.run("shippo", (signal) =>
        validateShippingAddress(address, env.SHIPPO_API_TOKEN, deadlineFetch(signal)),
      ),
    outcome: scheduleOperationalOutcome,
    consumePermit: (token) => permits.consume(token),
    loadOrder: (orderId) => reservations.findPaymentCheckout(orderId),
    createPayment: (input) => {
      // A delayed claim response can outlive its capacity lease. Keep the
      // committed obligation observable without starting a late provider call.
      gatewaySignal?.throwIfAborted();
      return getPayments().create(input);
    },
    savePaymentId: async (orderId, paymentId, payment, method) => {
      await orders.updatePaymentTransactionId(orderId, paymentId);
      await recordSquarePaymentDetails(supabase, {
        squareOrderId: payment.orderId,
        paymentId,
        status: payment.status,
        amountCents: payment.totalCents,
        currency: "USD",
        details: {
          source_type: payment.details?.source_type ?? null,
          payment_method: payment.details?.payment_method ?? method,
        },
      });
    },
    getClientIp: getTrustedClientIp,
    acquireGateway: async (input) => {
      const result = await limiter.admit({ kind: "gateway_attempt", ...input });
      if (!result.allowed)
        return { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
      const slot = await capacity.acquire("square");
      gatewaySignal = slot.signal;
      return { allowed: true, release: slot.release };
    },
    recordDecline: (input) => limiter.admit({ kind: "decline", ...input }),
    declineCode: squareDeclineCode,
    reportError: (error) =>
      logError(error, { layer: "api", route: "/api/checkout/pay", requestId }),
    now: () => new Date(),
  };
}
