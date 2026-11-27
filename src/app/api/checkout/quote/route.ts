import { observeCheckoutRequest } from "@/Modules/Checkout/Source/Features/Operations/request-metrics";
import type { NextRequest } from "next/server";

import { checkoutQuoteHandler } from "@/lib/checkout/checkout-quote";
import { createCheckoutQuoteDependencies } from "@/lib/checkout/checkout-quote-dependencies";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";

export const runtime = "nodejs";

export function POST(request: NextRequest): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);
  return observeCheckoutRequest("/api/checkout/quote", "POST", requestId, () =>
    checkoutQuoteHandler(request, createCheckoutQuoteDependencies(requestId, request)),
  );
}
