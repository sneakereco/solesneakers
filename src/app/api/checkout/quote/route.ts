import type { NextRequest } from "next/server";

import { checkoutQuoteHandler } from "@/lib/checkout/checkout-quote";
import { createCheckoutQuoteDependencies } from "@/lib/checkout/checkout-quote-dependencies";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";

export const runtime = "nodejs";

export function POST(request: NextRequest): Promise<Response> {
  return checkoutQuoteHandler(
    request,
    createCheckoutQuoteDependencies(getRequestIdFromHeaders(request.headers)),
  );
}
