import type { NextRequest } from "next/server";

import type { CheckoutAccessDecision } from "@/lib/checkout/checkout-access";
import type { ResolvedCheckoutCart } from "@/lib/checkout/checkout-cart-resolver";
import type {
  CheckoutPricingQuote,
  CheckoutPricingQuoteInput,
} from "@/lib/checkout/checkout-pricing-gateway";
import { createCheckoutQuoteFingerprint } from "@/lib/checkout/checkout-quote-fingerprint";
import {
  checkoutQuoteRequestSchema,
  type CheckoutQuoteRequest,
  type CheckoutQuoteResponse,
  type CheckoutTotals,
} from "@/lib/checkout/checkout-request";
import type { CheckoutBotVerdict } from "@/lib/security/checkout-bot";
import type { SquareCheckoutOrderPayloadInput } from "@/lib/square/checkout-order-payload";

export type CheckoutQuoteDependencies = {
  findTenantId(): Promise<string | null>;
  getAccess(tenantId: string): Promise<CheckoutAccessDecision>;
  verifyBrowser(): Promise<CheckoutBotVerdict>;
  resolveCart(
    tenantId: string,
    items: CheckoutQuoteRequest["items"],
  ): Promise<ResolvedCheckoutCart>;
  quote(input: CheckoutPricingQuoteInput): Promise<CheckoutPricingQuote>;
  calculateSquareOrder(input: SquareCheckoutOrderPayloadInput): Promise<CheckoutTotals>;
  reportError(error: unknown): void;
};

function json(body: CheckoutQuoteResponse | { error: string }, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function checkoutQuoteHandler(
  request: NextRequest,
  deps: CheckoutQuoteDependencies,
): Promise<Response> {
  try {
    const tenantId = await deps.findTenantId();
    if (!tenantId) {
      return json({ error: "Checkout totals are temporarily unavailable" }, 503);
    }
    const access = await deps.getAccess(tenantId);
    if (!access.open) {
      return json({ error: access.message }, 503);
    }
    const bot = await deps.verifyBrowser();
    if (!bot.allowed) {
      return json(
        { error: "Checkout verification failed" },
        bot.reason === "bot" ? 403 : 503,
      );
    }

    const parsed = checkoutQuoteRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return json({ error: "Invalid checkout request" }, 400);
    }

    const cart = await deps.resolveCart(tenantId, parsed.data.items);
    const pricing = await deps.quote({
      tenantId,
      fulfillment: parsed.data.fulfillment,
      shippingAddress: parsed.data.shippingAddress,
      subtotalCents: cart.subtotalCents,
      items: cart.items,
    });

    if (parsed.data.fulfillment === "ship" && !parsed.data.shippingAddress) {
      return json(
        {
          completeness: "preliminary",
          totals: {
            subtotalCents: cart.subtotalCents,
            shippingCents: pricing.shippingCents,
            taxCents: null,
            totalCents: cart.subtotalCents + pricing.shippingCents,
          },
          quoteFingerprint: null,
        },
        200,
      );
    }

    const totals = await deps.calculateSquareOrder({
      fulfillment: parsed.data.fulfillment,
      subtotalCents: cart.subtotalCents,
      shippingCents: pricing.shippingCents,
      shippingAddress: parsed.data.shippingAddress,
      items: cart.items,
    });
    const quoteFingerprint = createCheckoutQuoteFingerprint({
      items: cart.items.map(({ variantId, quantity, unitPriceCents }) => ({
        variantId,
        quantity,
        unitPriceCents,
      })),
      fulfillment: parsed.data.fulfillment,
      shippingAddress: parsed.data.shippingAddress,
      totals,
    });

    return json({ completeness: "exact", totals, quoteFingerprint }, 200);
  } catch (error) {
    deps.reportError(error);
    return json({ error: "Checkout totals are temporarily unavailable" }, 503);
  }
}
