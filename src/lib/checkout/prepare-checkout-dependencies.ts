import { assertCheckoutOpen } from "@/lib/checkout/checkout-access";
import { createCheckoutAttemptLimiter } from "@/lib/checkout/checkout-attempt-limit";
import { resolveCheckoutCart } from "@/lib/checkout/checkout-cart-resolver";
import { createCheckoutPricingGateway } from "@/lib/checkout/checkout-pricing-gateway";
import {
  getCheckoutIdentitySecret,
  hashNormalizedCheckoutEmail,
} from "@/lib/checkout/checkout-identity";
import type { PrepareCheckoutDependencies } from "@/lib/checkout/prepare-checkout";
import { getServerSession } from "@/lib/auth/session";
import { getTrustedClientIp } from "@/lib/http/client-ip";
import { verifyCheckoutBrowser } from "@/lib/security/checkout-bot";
import { createSquareCheckoutOrdersGateway } from "@/lib/square/client";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";
import { CheckoutReservationRepository } from "@/repositories/checkout-reservation-repo";
import { ProductRepository } from "@/repositories/product-repo";
import { ShippingDefaultsRepository } from "@/repositories/shipping-defaults-repo";
import { TenantRepository } from "@/repositories/tenant-repo";
import { OrderAccessTokenService } from "@/services/order-access-token-service";

export function createPrepareCheckoutDependencies(
  requestId: string,
): PrepareCheckoutDependencies {
  const supabase = createSupabaseAdminClient();
  const tenants = new TenantRepository(supabase);
  const products = new ProductRepository(supabase);
  const reservations = new CheckoutReservationRepository(supabase);
  const shipping = new ShippingDefaultsRepository(supabase);
  const accessTokens = new OrderAccessTokenService(supabase);
  const limiter = createCheckoutAttemptLimiter();
  const pricing = createCheckoutPricingGateway(shipping);
  const squareOrders = createSquareCheckoutOrdersGateway();

  return {
    findTenantId: () => tenants.getFirstTenantId(),
    getAccess: assertCheckoutOpen,
    verifyBrowser: verifyCheckoutBrowser,
    getClientIp: getTrustedClientIp,
    getSession: getServerSession,
    hashEmail: (email) => hashNormalizedCheckoutEmail(email, getCheckoutIdentitySecret()),
    findExisting: (tenantId, idempotencyKey) =>
      reservations.findByIdempotencyKey(tenantId, idempotencyKey),
    checkAttempt: (identity) => limiter.check(identity),
    resolveCart: (tenantId, items) => resolveCheckoutCart(products, tenantId, items),
    quote: (input) => pricing.quote(input),
    reserve: (input) => reservations.reserve(input),
    createGuestAccessToken: async (orderId) =>
      (await accessTokens.createToken({ orderId })).token,
    createSquareOrder: (input) => squareOrders.create(input),
    attachSquareOrder: (orderId, order) => reservations.attachSquareOrder(orderId, order),
    cancelSquareOrder: (orderId, version, idempotencyKey) =>
      squareOrders.cancel(orderId, version, idempotencyKey),
    releaseReservation: (orderId, reason) => reservations.release(orderId, reason),
    reportError: (error) =>
      logError(error, { layer: "api", route: "/api/checkout/prepare", requestId }),
    now: () => new Date(),
  };
}
