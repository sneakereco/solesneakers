import { assertCheckoutOpen } from "@/lib/checkout/checkout-access";
import { createCheckoutAttemptLimiter } from "@/lib/checkout/checkout-attempt-limit";
import { resolveCheckoutCart } from "@/lib/checkout/checkout-cart-resolver";
import { createCheckoutPricingGateway } from "@/lib/checkout/checkout-pricing-gateway";
import {
  getCheckoutIdentitySecret,
  hashNormalizedCheckoutEmail,
} from "@/lib/checkout/checkout-identity";
import type { CreatePaymentLinkDependencies } from "@/lib/checkout/create-payment-link";
import { getServerSession } from "@/lib/auth/session";
import { getTrustedClientIp } from "@/lib/http/client-ip";
import { verifyCheckoutBrowser } from "@/lib/security/checkout-bot";
import { createSquarePaymentLinksGateway } from "@/lib/square/client";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";
import { CheckoutReservationRepository } from "@/repositories/checkout-reservation-repo";
import { ProductRepository } from "@/repositories/product-repo";
import { ShippingDefaultsRepository } from "@/repositories/shipping-defaults-repo";
import { TenantRepository } from "@/repositories/tenant-repo";
import { OrderAccessTokenService } from "@/services/order-access-token-service";

function getCheckoutSiteUrl(): string {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) {
    throw new Error("checkout_site_url_missing");
  }
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("checkout_site_url_invalid");
  }
  return url.origin;
}

export function createPaymentLinkDependencies(
  requestId: string,
): CreatePaymentLinkDependencies {
  const supabase = createSupabaseAdminClient();
  const tenantRepository = new TenantRepository(supabase);
  const productRepository = new ProductRepository(supabase);
  const reservationRepository = new CheckoutReservationRepository(supabase);
  const shippingDefaultsRepository = new ShippingDefaultsRepository(supabase);
  const accessTokenService = new OrderAccessTokenService(supabase);
  const limiter = createCheckoutAttemptLimiter();
  const pricingGateway = createCheckoutPricingGateway(shippingDefaultsRepository);
  let squareGateway: ReturnType<typeof createSquarePaymentLinksGateway> | null = null;

  const getSquareGateway = () => {
    squareGateway ??= createSquarePaymentLinksGateway();
    return squareGateway;
  };

  return {
    findTenantId: () => tenantRepository.getFirstTenantId(),
    getAccess: assertCheckoutOpen,
    verifyBrowser: verifyCheckoutBrowser,
    getClientIp: getTrustedClientIp,
    getSession: getServerSession,
    hashEmail: (email) => hashNormalizedCheckoutEmail(email, getCheckoutIdentitySecret()),
    findExisting: (tenantId, idempotencyKey) =>
      reservationRepository.findByIdempotencyKey(tenantId, idempotencyKey),
    checkAttempt: (identity) => limiter.check(identity),
    resolveCart: (tenantId, items) =>
      resolveCheckoutCart(productRepository, tenantId, items),
    quote: (input) => pricingGateway.quote(input),
    reserve: (input) => reservationRepository.reserve(input),
    createGuestAccessToken: async (orderId) => {
      const { token } = await accessTokenService.createToken({ orderId });
      return token;
    },
    createSquareLink: (input) => getSquareGateway().create(input),
    attachSquareLink: (orderId, link) =>
      reservationRepository.attachPaymentLink(orderId, link),
    deleteSquareLink: (paymentLinkId) => getSquareGateway().delete(paymentLinkId),
    markSquareLinkDeleted: (orderId, paymentLinkId) =>
      reservationRepository.markPaymentLinkDeleted(orderId, paymentLinkId),
    releaseReservation: (orderId, reason) =>
      reservationRepository.release(orderId, reason),
    reportError: (error) =>
      logError(error, {
        layer: "api",
        requestId,
        route: "/api/checkout/payment-link",
        event: "checkout_payment_link_failed",
      }),
    now: () => new Date(),
    siteUrl: getCheckoutSiteUrl(),
  };
}
