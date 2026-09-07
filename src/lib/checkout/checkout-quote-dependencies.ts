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
): CheckoutQuoteDependencies {
  const supabase = createSupabaseAdminClient();
  const tenants = new TenantRepository(supabase);
  const products = new ProductRepository(supabase);
  const pricing = createCheckoutPricingGateway(new ShippingDefaultsRepository(supabase));
  let squareOrders: ReturnType<typeof createSquareCheckoutOrdersGateway> | null = null;
  const getSquareOrders = () => (squareOrders ??= createSquareCheckoutOrdersGateway());

  return {
    findTenantId: () => tenants.getFirstTenantId(),
    getAccess: assertCheckoutOpen,
    verifyBrowser: verifyCheckoutBrowser,
    resolveCart: (tenantId, items) => resolveCheckoutCart(products, tenantId, items),
    quote: (input) => pricing.quote(input),
    calculateSquareOrder: (input) => getSquareOrders().calculate(input),
    reportError: (error) =>
      logError(error, { layer: "api", route: "/api/checkout/quote", requestId }),
  };
}
