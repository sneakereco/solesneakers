import type { NextRequest } from "next/server";
import { prepareCheckoutHandler } from "@/lib/checkout/prepare-checkout";
import { createPrepareCheckoutDependencies } from "@/lib/checkout/prepare-checkout-dependencies";
import { observeCheckoutRequest } from "@/Modules/Checkout/Source/Features/Operations/request-metrics";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";

export const runtime = "nodejs";
export function POST(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);
  return observeCheckoutRequest("/api/checkout/review", "POST", requestId, () =>
    prepareCheckoutHandler(request, createPrepareCheckoutDependencies(requestId), {
      reviewOnly: true,
    }),
  );
}
