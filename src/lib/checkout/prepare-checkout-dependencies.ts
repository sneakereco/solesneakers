import { deadlineFetch } from "@/Modules/Checkout/Source/Features/Recovery/recovery-worker";
import { CheckoutProviderCapacity } from "@/lib/checkout/checkout-attempt-limit";
import { checkoutAdmissionBudgets } from "@/Modules/Checkout/Source/Features/Operations/admission";
import { CheckoutPreparationRepository } from "@/Modules/Checkout/Source/Features/Preparation/reservation-repository";
import { readOriginalRetryExpiration } from "@/Modules/Checkout/Source/Features/Preparation/read-original-hold";
import { validateShippingAddress } from "@/lib/shipping/validate-shipping-address";
import { assertCheckoutOpen } from "@/lib/checkout/checkout-access";
import { env } from "@/config/env";
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
import { getSquareConfig } from "@/lib/square/config";
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
  const capacity = new CheckoutProviderCapacity(supabase, checkoutAdmissionBudgets);
  const tenants = new TenantRepository(supabase);
  const products = new ProductRepository(supabase);
  const reservations = new CheckoutReservationRepository(supabase);
  const preparation = new CheckoutPreparationRepository(supabase);
  const shipping = new ShippingDefaultsRepository(supabase);
  const accessTokens = new OrderAccessTokenService(supabase);
  const limiter = createCheckoutAttemptLimiter();
  const pricing = createCheckoutPricingGateway(shipping);

  return {
    shippingConfirmationSecret: getCheckoutIdentitySecret,
    validateShippingAddress: (address) =>
      capacity.run("shippo", (signal) =>
        validateShippingAddress(address, env.SHIPPO_API_TOKEN, deadlineFetch(signal)),
      ),
    findTenantId: () => tenants.getFirstTenantId(),
    getAccess: assertCheckoutOpen,
    verifyBrowser: verifyCheckoutBrowser,
    getClientIp: getTrustedClientIp,
    getSession: getServerSession,
    hashEmail: (email) => hashNormalizedCheckoutEmail(email, getCheckoutIdentitySecret()),
    findExisting: (tenantId, idempotencyKey) =>
      reservations.findByIdempotencyKey(tenantId, idempotencyKey),
    readRetryExpiration: (tenantId, existing) =>
      readOriginalRetryExpiration(supabase, tenantId, existing),
    checkAddressValidationAttempt: (identity) => limiter.checkAddressValidation(identity),
    checkResume: ({ shopperBinding, ip, attached }) =>
      attached
        ? limiter.admit({ kind: "resume", shopperBinding, ip })
        : limiter.coarse(ip),
    checkAttempt: (identity) => limiter.check(identity),
    resolveCart: (tenantId, items) =>
      resolveCheckoutCart(products, tenantId, items, "reservation"),
    quote: (input) => pricing.quote(input),
    calculateSquareOrder: (input) =>
      capacity.run("square", (signal) =>
        createSquareCheckoutOrdersGateway(signal).calculate(input),
      ),
    reserve: (input) => preparation.reserveCheckout(input),
    inspectUnavailable: (tenant, key, items, ownerBinding, otherGuestContexts) =>
      preparation.inspectUnavailable(
        tenant,
        key,
        items,
        ownerBinding,
        otherGuestContexts,
      ),
    createGuestAccessToken: async (orderId) =>
      (await accessTokens.createToken({ orderId })).token,
    getSquareClientConfig: () => {
      const config = getSquareConfig();
      if (!env.SQUARE_APPLICATION_ID) {
        throw new Error("square_configuration_invalid");
      }
      return {
        applicationId: env.SQUARE_APPLICATION_ID,
        locationId: config.locationId,
        environment: config.environment,
      };
    },
    createSquareOrder: (input) =>
      capacity.run("square", (signal) =>
        createSquareCheckoutOrdersGateway(signal).create(input),
      ),
    attachSquareOrder: (orderId, order) => reservations.attachSquareOrder(orderId, order),
    rejectBeforeAttach: (orderId, ownerBinding) =>
      preparation.rejectBeforeAttach(orderId, ownerBinding),
    cancelSquareOrder: (orderId, version, idempotencyKey) =>
      capacity.run("square", (signal) =>
        createSquareCheckoutOrdersGateway(signal).cancel(
          orderId,
          version,
          idempotencyKey,
        ),
      ),
    releaseReservation: (orderId, reason) => reservations.release(orderId, reason),
    reportError: (error) =>
      logError(error, { layer: "api", route: "/api/checkout/prepare", requestId }),
    now: () => new Date(),
  };
}
