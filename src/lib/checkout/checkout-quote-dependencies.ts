import { CheckoutProviderCapacity } from "@/lib/checkout/checkout-attempt-limit";
import { checkoutAdmissionBudgets } from "@/Modules/Checkout/Source/Features/Operations/admission";
import type { NextRequest } from "next/server";
import { getTrustedClientIp } from "@/lib/http/client-ip";
import { createCheckoutAttemptLimiter } from "@/lib/checkout/checkout-attempt-limit";
import { assertCheckoutOpen } from "@/lib/checkout/checkout-access";
import { resolveCheckoutCart } from "@/lib/checkout/checkout-cart-resolver";
import { createCheckoutPricingGateway } from "@/lib/checkout/checkout-pricing-gateway";
import type { CheckoutQuoteDependencies } from "@/lib/checkout/checkout-quote";
import { verifyCheckoutBrowser } from "@/lib/security/checkout-bot";
import { createSquareCheckoutOrdersGateway } from "@/lib/square/client";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";
import { ProductRepository } from "@/repositories/product-repo";
import { ShippingDefaultsRepository } from "@/repositories/shipping-defaults-repo";
import { TenantRepository } from "@/repositories/tenant-repo";

export function createCheckoutQuoteDependencies(
  requestId: string,
  request: NextRequest,
): CheckoutQuoteDependencies {
  const supabase = createSupabaseAdminClient();
  const capacity = new CheckoutProviderCapacity(supabase, checkoutAdmissionBudgets);
  const limiter = createCheckoutAttemptLimiter();
  const tenants = new TenantRepository(supabase);
  const products = new ProductRepository(supabase);
  const pricing = createCheckoutPricingGateway(new ShippingDefaultsRepository(supabase));

  return {
    findTenantId: () => tenants.getFirstTenantId(),
    getAccess: assertCheckoutOpen,
    verifyBrowser: verifyCheckoutBrowser,
    resolveCart: (tenantId, items) => resolveCheckoutCart(products, tenantId, items),
    quote: (input) => pricing.quote(input),
    calculateSquareOrder: async (input) => {
      const ip = getTrustedClientIp(request);
      if (!ip) throw Error("checkout_protection_unavailable");
      const decision = await limiter.coarse(ip);
      if (!decision.allowed) throw Error("checkout_quote_capacity_unavailable");
      return capacity.run("square", (signal) =>
        createSquareCheckoutOrdersGateway(signal).calculate(input),
      );
    },
    reportError: (error) =>
      logError(error, { layer: "api", route: "/api/checkout/quote", requestId }),
  };
}
